// servicepower-claims-sync — reconcile ServicePower (SQUARE TRADE) claim payments
// AUTOMATICALLY so nobody opens the claims portal claim-by-claim.
//
// Each run: pull our completed/claimed dispatches → retrieve each claim by its
// dispatch/call number → track status (Forwarded→Approved→Paid, or Rejected) +
// paid amount + EFT date/#. Alerts Teddy on transitions that matter:
//   • newly PAID  → money in (with EFT date/#)
//   • REJECTED / Mfg-Reject → money to chase (don't let it fall through)
// Terminal claims (Paid/Rejected) are remembered + skipped on future runs, so
// steady-state each run only re-checks the few still in-flight = fast.
//
//   GET (scheduled, no params)  → runs sync, alerts on transitions, returns counts
//   GET ?secret=<admin>         → also returns the FULL rollup (claim details)
//   GET ?dryrun=1               → no state write, no SMS (inspect only)
//   GET ?days=N&chunk=M&max=K   → tune window / lookups
'use strict';

const sp = require('./_lib/servicepower');
const claims = require('./_lib/servicepower-claims');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const OWNER = '+16154855795';
const TERMINAL = new Set(['P', 'R', 'W']);  // Paid / Rejected / Mfg-Reject — won't change again
const STATUS_NAME = { D: 'Dtr Review', F: 'Forwarded', I: 'Incomplete', K: 'FSS Review', M: 'Mfg Review', P: 'Paid', R: 'Rejected', S: 'Approved', W: 'Mfg-Reject' };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// mm/dd/yyyy HH:mm:ss windows, `chunk` days each, going back `days` (avoids SP007 wide-range cap)
function windows(days, chunk) {
  const out = []; const now = Date.now(); const DAY = 86400000;
  for (let off = 0; off < days; off += chunk) {
    const to = new Date(now - off * DAY); const from = new Date(now - Math.min(off + chunk, days) * DAY);
    const f = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} 00:00:00`;
    out.push({ from: f(from), to: f(to) });
  }
  return out;
}

async function loadState() {
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'sp_claim_sync_state' }, { id: 'desc' });
    let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return (m && m.map) || {};
  } catch (_) { return {}; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const showDetail = q.secret === admin;

  if (!(await claims.isConfigured())) return json(200, { ok: false, error: 'ServicePower creds not in vault' });

  const days = Math.min(parseInt(q.days || '30', 10) || 30, 90);
  const chunk = Math.max(parseInt(q.chunk || '3', 10) || 3, 1);
  const maxLookups = Math.min(parseInt(q.max || '50', 10) || 50, 200);
  const startMs = Date.now();
  const BUDGET_MS = 22000;  // stop starting new lookups after this; rest caught next run

  // 1) gather our dispatch call numbers (completed/claimed) from the board
  const callMap = new Map();  // call -> {who, brand, status}
  try {
    for (const w of windows(days, chunk)) {
      if (Date.now() - startMs > BUDGET_MS) break;
      const r = await sp.getCallInfo({ fromDateTime: w.from, toDateTime: w.to });
      for (const c of (r.calls || [])) {
        const st = String(c.status || '').toUpperCase();
        if (!c.call_number) continue;
        if (st === 'COMPLETED' || st === 'CLAIMED') {
          if (!callMap.has(c.call_number)) callMap.set(c.call_number, { who: `${c.first_name || ''} ${c.last_name || ''}`.trim(), brand: c.brand || '', dispatch_status: st });
        }
      }
    }
  } catch (e) { return json(200, { ok: false, error: 'dispatch pull failed: ' + String((e && e.message) || e) }); }

  // 2) decide which to look up — skip claims already terminal in prior state
  const prior = await loadState();
  const allCalls = [...callMap.keys()];
  const toLookup = allCalls.filter((c) => !(prior[c] && TERMINAL.has(prior[c].status))).slice(0, maxLookups);

  // 3) retrieve each claim (time-budgeted)
  const results = []; const transitions = [];
  for (const call of toLookup) {
    if (Date.now() - startMs > BUDGET_MS) break;
    let res; try { res = await claims.retrieveClaims({ callNumber: call }); } catch (_) { continue; }
    const c = (res.claims || [])[0];
    if (!c) { results.push({ call, found: false, msg: (res.messages || [])[0] || '' }); continue; }
    const rec = {
      call, status: c.status_code || '', status_name: c.status_description || STATUS_NAME[c.status_code] || '',
      paid_total: c.paid_total || 0, eft_date: c.payment_date || '', eft_num: c.payment_transaction_number || '',
      brand: c.brand || callMap.get(call)?.brand || '', who: callMap.get(call)?.who || '',
      model: c.model || '', received: c.received_date || '',
    };
    results.push(rec);
    const was = prior[call] && prior[call].status;
    if (was !== rec.status) transitions.push({ ...rec, from: was || '(new)' });
  }

  // 4) new snapshot = prior (terminal kept) merged with this run's results
  const map = { ...prior };
  for (const r of results) { if (r.found === false) continue; map[r.call] = { status: r.status, paid_total: r.paid_total, eft_date: r.eft_date, eft_num: r.eft_num }; }

  // 5) rollups
  const byStatus = {}; let paidSum = 0; let pendingSum = 0; const rejected = [];
  for (const call of Object.keys(map)) {
    const s = map[call].status || '?';
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (s === 'P') paidSum += Number(map[call].paid_total || 0);
    else if (!TERMINAL.has(s)) pendingSum += Number(map[call].paid_total || 0);
    if (s === 'R' || s === 'W') rejected.push(call);
  }
  const newlyPaid = transitions.filter((t) => t.status === 'P');
  const newlyRejected = transitions.filter((t) => t.status === 'R' || t.status === 'W');

  // 6) persist state + alert (unless dryrun)
  if (!dry) {
    try { await crud.logEvent('sp_claim_sync_state', { map, at_ms: Date.now() }); } catch (_) {}
    try {
      await crud.logEvent('sp_claim_sync_run', {
        looked_up: results.length, transitions: transitions.length,
        newly_paid: newlyPaid.length, newly_rejected: newlyRejected.length,
        by_status: byStatus, paid_sum: paidSum, at_ms: Date.now(),
      });
    } catch (_) {}

    if (newlyPaid.length || newlyRejected.length) {
      let body = '[ant] 💵 ServicePower claims update:\n';
      if (newlyPaid.length) {
        const sum = newlyPaid.reduce((a, t) => a + Number(t.paid_total || 0), 0);
        body += `\n✅ ${newlyPaid.length} newly PAID ($${sum.toFixed(2)}):\n`
          + newlyPaid.slice(0, 8).map((t) => `  • ${t.who || t.call} ${t.brand} — $${Number(t.paid_total).toFixed(2)} (EFT ${t.eft_date} #${t.eft_num})`).join('\n');
      }
      if (newlyRejected.length) {
        body += `\n\n⚠️ ${newlyRejected.length} REJECTED — chase these:\n`
          + newlyRejected.slice(0, 8).map((t) => `  • ${t.who || t.call} ${t.brand} (${t.status_name})`).join('\n');
      }
      try { await sendSms(OWNER, body, 'owner', 'sp_claims_sync'); } catch (_) {}
    }
  }

  const out = {
    ok: true, mode: dry ? 'dryrun' : 'live',
    window_days: days, dispatch_completed_claimed: allCalls.length,
    looked_up: results.length, budget_hit: Date.now() - startMs > BUDGET_MS,
    transitions: transitions.length, newly_paid: newlyPaid.length, newly_rejected: newlyRejected.length,
    by_status: byStatus, paid_total_all_time: Number(paidSum.toFixed(2)), pending_value: Number(pendingSum.toFixed(2)),
    rejected_calls: rejected.length,
  };
  if (showDetail) { out.transitions_detail = transitions; out.claims = results.slice(0, 60); }
  return json(200, out);
};
