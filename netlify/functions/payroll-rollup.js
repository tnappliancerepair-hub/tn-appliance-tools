// Payroll rollup for the office Money hub. Reads the invoice rows the office
// logs (event_log action="office_invoice_logged", carrying technician_id +
// tech_pay + the breakdown), buckets them into a pay period, and groups by
// tech — the self-building version of the per-tech Google payroll sheets.
//
// GET /.netlify/functions/payroll-rollup?start_ms=...&end_ms=...
// -> { success, start_ms, end_ms, techs:[{technician_id, tech_pay, labor,
//      parts, tax, amount, job_count, jobs:[{job_id,pay,labor,total,when}]}] }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
async function fetchByAction(action, maxPages) {
  const out = [];
  for (let page = 1; page <= (maxPages || 6); page++) {
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
      method: 'POST', headers: headers(),
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
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const start = parseInt(q.start_ms, 10) || 0;
  const end = parseInt(q.end_ms, 10) || Date.now();

  try {
    const [invoices, payouts, feedback, addons] = await Promise.all([
      fetchByAction('office_invoice_logged'),
      fetchByAction('tech_payout_recorded'),
      fetchByAction('customer_feedback_recorded'),
      fetchByAction('addon_fulfilled'),
    ]);
    // job_ids that have already been paid out (per-job release), so we never double-pay.
    const releasedJobs = new Set();
    for (const p of payouts) { const m = meta(p); if (m.job_id) releasedJobs.add(String(m.job_id)); }
    // 5-star reviews per tech in the period -> $10 each bonus.
    const reviewByTech = {};
    for (const f of feedback) {
      const m = meta(f);
      const when = num(m.recorded_at_ms) || (f.created_at ? Date.parse(f.created_at) : 0);
      if (parseInt(m.rating, 10) === 5 && when >= start && when <= end) {
        const tt = parseInt(m.technician_id, 10) || 0;
        if (tt) reviewByTech[tt] = (reviewByTech[tt] || 0) + 1;
      }
    }

    // Latest invoice per job, kept if it falls in the window.
    const byJob = {};
    for (const row of invoices) {
      const m = meta(row);
      const when = num(m.logged_at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      const jid = m.job_id;
      if (!byJob[jid] || when > byJob[jid].when) {
        byJob[jid] = {
          job_id: jid, technician_id: parseInt(m.technician_id, 10) || 0,
          pay: num(m.tech_pay), labor: num(m.labor), parts: num(m.parts_charge),
          tax: num(m.tax), total: num(m.amount_invoiced), when,
        };
      }
    }
    const techs = {};
    for (const j of Object.values(byJob)) {
      if (j.when < start || j.when > end) continue;
      if (!j.technician_id) continue;
      const t = techs[j.technician_id] || (techs[j.technician_id] = { technician_id: j.technician_id, tech_pay: 0, labor: 0, parts: 0, tax: 0, amount: 0, released_total: 0, jobs: [] });
      const released = releasedJobs.has(String(j.job_id));
      t.tech_pay += j.pay; t.labor += j.labor; t.parts += j.parts; t.tax += j.tax; t.amount += j.total;
      if (released) t.released_total += j.pay;
      t.jobs.push({ job_id: j.job_id, pay: j.pay, labor: j.labor, total: j.total, when: j.when, released: released });
    }

    // Fulfilled add-ons -> payable line items for the assigned tech. De-dupe per
    // job+addon; carry a synthetic payout id ("A:<job>:<key>") so releasing an
    // add-on doesn't collide with the job's base invoice payout.
    const addonSeen = new Set();
    for (const row of addons) {
      const m = meta(row);
      const tid = parseInt(m.technician_id, 10) || 0;
      const cut = num(m.tech_cut);
      if (!tid || !cut) continue;
      const when = num(m.requested_at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      if (when < start || when > end) continue;
      const dedupe = m.job_id + '|' + m.addon_key;
      if (addonSeen.has(dedupe)) continue;
      addonSeen.add(dedupe);
      const payoutId = 'A:' + m.job_id + ':' + m.addon_key;
      const released = releasedJobs.has(payoutId);
      const t = techs[tid] || (techs[tid] = { technician_id: tid, tech_pay: 0, labor: 0, parts: 0, tax: 0, amount: 0, released_total: 0, addon_pay: 0, jobs: [] });
      // add-on cut counts toward what the tech is owed, tracked separately so the
      // P&L (which has its own add-on margin line) doesn't double-count it.
      t.tech_pay += cut; t.addon_pay = (t.addon_pay || 0) + cut;
      if (released) t.released_total += cut;
      t.jobs.push({ job_id: payoutId, label: (m.name || 'Add-on') + ' · #' + m.job_id, pay: cut, labor: 0, total: num(m.net_price || m.price), when: when, released: released, addon: true });
    }
    const out = Object.values(techs).map((t) => ({
      technician_id: t.technician_id,
      tech_pay: Number(t.tech_pay.toFixed(2)), labor: Number(t.labor.toFixed(2)),
      parts: Number(t.parts.toFixed(2)), tax: Number(t.tax.toFixed(2)), amount: Number(t.amount.toFixed(2)),
      addon_pay: Number((t.addon_pay || 0).toFixed(2)),
      released_total: Number(t.released_total.toFixed(2)),
      remaining: Number((t.tech_pay - t.released_total).toFixed(2)),
      review_count: reviewByTech[t.technician_id] || 0,
      review_bonus: Number(((reviewByTech[t.technician_id] || 0) * 10).toFixed(2)),
      job_count: t.jobs.length, jobs: t.jobs.sort((a, b) => b.when - a.when),
    })).sort((a, b) => a.technician_id - b.technician_id);

    return { statusCode: 200, body: JSON.stringify({ success: true, start_ms: start, end_ms: end, techs: out }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
