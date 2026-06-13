// Tech earnings + running balance. Reads the invoice rows the office logs
// (event_log action="office_invoice_logged", which now carries technician_id +
// tech_pay) and the payouts (action="tech_payout_recorded"), and returns:
//   earned (all-time tech pay) - paid (all-time payouts) = owed now
// plus the per-job breakdown so the tech sees what each job made them.
//
// GET /.netlify/functions/tech-earnings?tech_id=3
// -> { success, tech_id, earned, paid, owed, jobs:[{job_id,pay,labor,when}] }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Pull all event_log rows for one action (single-field search — the only kind
// Xano's metadata search honors), newest first, a few pages deep.
async function fetchByAction(action, maxPages) {
  const out = [];
  for (let page = 1; page <= (maxPages || 4); page++) {
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 500, page }),
    });
    if (!r.ok) break;
    const d = await r.json();
    const items = (d && d.items) || [];
    out.push(...items);
    if (items.length < 500) break;
  }
  return out;
}

function meta(row) {
  let m = row && row.metadata;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
  return m || {};
}
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const techId = parseInt((event.queryStringParameters || {}).tech_id, 10);
  if (!techId) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'tech_id required' }) };

  try {
    const [invoices, payouts, addons, tips] = await Promise.all([
      fetchByAction('office_invoice_logged'),
      fetchByAction('tech_payout_recorded'),
      fetchByAction('addon_fulfilled'),
      fetchByAction('tech_tip_paid'),
    ]);

    // Latest invoice per job for this tech (an edit re-logs the job).
    const byJob = {};
    for (const row of invoices) {
      const m = meta(row);
      if (parseInt(m.technician_id, 10) !== techId) continue;
      const jid = m.job_id;
      const when = num(m.logged_at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      if (!byJob[jid] || when > byJob[jid].when) {
        byJob[jid] = { job_id: jid, pay: num(m.tech_pay), labor: num(m.labor), amount: num(m.amount_invoiced), when };
      }
    }
    const jobs = Object.values(byJob).sort((a, b) => b.when - a.when);

    // Fulfilled add-ons credit the tech their cut (extra money for low-risk
    // work). De-dupe per job+addon (a re-fulfill shouldn't double-pay).
    const addonByKey = {};
    for (const row of addons) {
      const m = meta(row);
      if (parseInt(m.technician_id, 10) !== techId) continue;
      const cut = num(m.tech_cut);
      if (!cut) continue;
      const key = m.job_id + '|' + m.addon_key;
      const when = num(m.requested_at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      if (!addonByKey[key] || when > addonByKey[key].when) {
        addonByKey[key] = { job_id: m.job_id, addon_key: m.addon_key, name: m.name || m.addon_key, cut, when };
      }
    }
    const addonList = Object.values(addonByKey).sort((a, b) => b.when - a.when);
    const addonEarned = addonList.reduce((s, a) => s + a.cut, 0);

    // Tips (100% to the tech), de-duped per Stripe session.
    const tipSeen = new Set();
    const tipList = [];
    for (const row of tips) {
      const m = meta(row);
      if (parseInt(m.technician_id, 10) !== techId) continue;
      const sid = m.session_id || (m.job_id + '|' + (m.at_ms || row.created_at));
      if (tipSeen.has(sid)) continue;
      tipSeen.add(sid);
      const amt = num(m.amount);
      if (!amt) continue;
      const when = num(m.at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      tipList.push({ job_id: m.job_id, amount: amt, when });
    }
    const tipEarned = tipList.reduce((s, t) => s + t.amount, 0);

    const earned = jobs.reduce((s, j) => s + j.pay, 0) + addonEarned + tipEarned;

    let paid = 0;
    for (const row of payouts) {
      const m = meta(row);
      if (parseInt(m.technician_id, 10) !== techId) continue;
      paid += num(m.amount);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        tech_id: techId,
        earned: Number(earned.toFixed(2)),
        paid: Number(paid.toFixed(2)),
        owed: Number((earned - paid).toFixed(2)),
        job_count: jobs.length,
        jobs: jobs.slice(0, 100),
        addon_earned: Number(addonEarned.toFixed(2)),
        addon_count: addonList.length,
        addons: addonList.slice(0, 100),
        tip_earned: Number(tipEarned.toFixed(2)),
        tip_count: tipList.length,
        tips: tipList.sort((a, b) => b.when - a.when).slice(0, 100),
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
