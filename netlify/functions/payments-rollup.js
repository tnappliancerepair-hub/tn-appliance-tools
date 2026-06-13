// Collected card payments in a period (real cash in via Stripe), from
// customer_payment_received rows. Powers the Money hub "Collected" card and the
// office board's 💵 paid indicator. De-dupes per Stripe session.
//
// GET /.netlify/functions/payments-rollup?start_ms=..&end_ms=..
// -> { ok, total, invoice, addon, tip, count, paid_jobs:[job_id,...] }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const start = Number(q.start_ms) || 0;
  const end = Number(q.end_ms) || Date.now();
  try {
    const rows = [];
    for (let page = 1; page <= 4; page++) {
      const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ search: { action: 'customer_payment_received' }, sort: { created_at: 'desc' }, per_page: 500, page }),
      });
      if (!r.ok) break;
      const d = await r.json();
      const items = (d && d.items) || [];
      rows.push(...items);
      if (items.length < 500) break;
    }
    // Refunded sessions drop out of collected + paid.
    const refunded = new Set();
    try {
      const rr = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ search: { action: 'customer_payment_refunded' }, sort: { created_at: 'desc' }, per_page: 500, page: 1 }),
      });
      if (rr.ok) { const rd = await rr.json(); for (const x of (rd && rd.items) || []) { const sid = meta(x).session_id; if (sid) refunded.add(sid); } }
    } catch (_) {}
    const seen = new Set();
    const paidJobs = new Set();
    let total = 0, invoice = 0, addon = 0, tip = 0, count = 0;
    for (const row of rows) {
      const m = meta(row);
      const sid = m.session_id;
      if (sid) { if (seen.has(sid) || refunded.has(sid)) continue; seen.add(sid); }
      const when = num(m.paid_at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      if (when < start || when > end) continue;
      const amt = num(m.amount);
      total += amt; count += 1;
      const kind = m.kind || 'invoice';
      if (kind === 'tip') tip += amt; else if (kind === 'addon') addon += amt; else invoice += amt;
      if (m.job_id) paidJobs.add(String(m.job_id));
    }
    const r2 = (n) => Number(n.toFixed(2));
    return { statusCode: 200, body: JSON.stringify({ ok: true, total: r2(total), invoice: r2(invoice), addon: r2(addon), tip: r2(tip), count, paid_jobs: Array.from(paidJobs) }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message, total: 0, count: 0, paid_jobs: [] }) };
  }
};
