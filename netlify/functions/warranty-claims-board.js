// warranty-claims-board — the control tower for the SquareTrade claims automation.
// Reads what the auto-submit sweep + the payment reconcile already logged and composes
// one pipeline: needs-a-fix (blocked TDR) -> ready to file -> filed -> paid/rejected.
// Cheap: only event_log reads (the heavy claim-build happens in the hourly sweep).
//
//   GET /.netlify/functions/warranty-claims-board  -> { ok, auto_live, counts, items[] }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function mdOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function jget(url) { const r = await fetch(url, { signal: AbortSignal.timeout(12000) }); return r.json().catch(() => ({})); }

// job_id -> latest metadata for an action
async function latestByJob(action, days) {
  const out = {};
  try {
    const d = await jget(`${XANO}/list_recent_event_log?action=${encodeURIComponent(action)}&days_back=${days}&limit=400`);
    for (const r of (d.items || [])) {
      const m = mdOf(r); const jid = Number(m.job_id || 0); if (!jid) continue;
      const ms = Number(m.at_ms) || Number(r.created_at) || 0;
      if (!out[jid] || ms > out[jid]._ms) out[jid] = { ...m, _ms: ms };
    }
  } catch (_) {}
  return out;
}

const STATUS_NAME = { P: 'Paid', R: 'Rejected', W: 'Mfg Reject', S: 'Approved', F: 'Forwarded', M: 'Mfg Review', I: 'Incomplete', K: 'FSS', D: 'Dtr' };

exports.handler = async function () {
  try {
    const auto = await latestByJob('sp_claim_autosubmit', 30);   // ready / blocked (+ customer, appliance, blockers, claim#)
    const filed = await latestByJob('sp_claim_submitted', 60);   // actually filed (confirmation/transaction)

    // Latest reconcile snapshot: call# -> { status, paid_total, eft_num }
    let sync = {};
    try {
      const d = await jget(`${XANO}/list_recent_event_log?action=sp_claim_sync_state&days_back=14&limit=3`);
      const rows = d.items || [];
      if (rows.length) sync = mdOf(rows[0]).map || {};
    } catch (_) {}

    const jobIds = new Set([...Object.keys(auto), ...Object.keys(filed)]);
    const items = [];
    for (const jid of jobIds) {
      const a = auto[jid] || {};
      const f = filed[jid] || null;
      const claim = String(a.claim_number || (f && f.claim_number) || '');
      const s = sync[claim] || {};
      const syncStatus = String(s.status || '').toUpperCase();
      const blockers = (a.blockers || []).filter(Boolean);
      const wasFiled = !!f || (a.mode === 'live' && a.ok);

      let state;
      if (syncStatus === 'P') state = 'paid';
      else if (syncStatus === 'R' || syncStatus === 'W') state = 'rejected';
      else if (wasFiled || syncStatus) state = 'filed';
      else if (blockers.length) state = 'blocked';
      else state = 'ready';

      items.push({
        job_id: Number(jid),
        customer: a.customer || (f && f.customer) || '',
        appliance: a.appliance || '',
        claim_number: claim,
        state,
        blockers,
        status_name: STATUS_NAME[syncStatus] || '',
        paid_total: Number(s.paid_total || 0),
        eft: s.eft_num || '',
        updated_ms: a._ms || (f && f._ms) || 0,
      });
    }

    const order = { blocked: 0, ready: 1, filed: 2, rejected: 3, paid: 4 };
    items.sort((x, y) => (order[x.state] - order[y.state]) || (y.updated_ms - x.updated_ms));
    const counts = {};
    for (const it of items) counts[it.state] = (counts[it.state] || 0) + 1;

    return json(200, {
      ok: true,
      auto_live: String(process.env.SP_CLAIM_AUTOSUBMIT_LIVE || '').toLowerCase() === 'true',
      counts,
      items,
    });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
