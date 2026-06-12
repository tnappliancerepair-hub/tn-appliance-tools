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
    const [invoices, payouts] = await Promise.all([
      fetchByAction('office_invoice_logged'),
      fetchByAction('tech_payout_recorded'),
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
    const earned = jobs.reduce((s, j) => s + j.pay, 0);

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
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
