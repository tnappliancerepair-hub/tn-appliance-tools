// Add-on sales tax collected in a period (tax-added add-ons charged via Stripe).
// Sums the `tax` on customer_payment_received rows (kind=addon), split by region,
// so the Money -> Tax view can show what's owed to each state.
//
// GET /.netlify/functions/addon-tax-rollup?start_ms=..&end_ms=..
// -> { ok, tn, la, total, count }

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
    const out = [];
    for (let page = 1; page <= 4; page++) {
      const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ search: { action: 'customer_payment_received' }, sort: { created_at: 'desc' }, per_page: 500, page }),
      });
      if (!r.ok) break;
      const d = await r.json();
      const items = (d && d.items) || [];
      out.push(...items);
      if (items.length < 500) break;
    }
    const seen = new Set();
    let tn = 0, la = 0, count = 0;
    for (const row of out) {
      const m = meta(row);
      if ((m.kind || 'invoice') !== 'addon') continue;
      const tax = num(m.tax);
      if (!tax) continue;
      const when = num(m.paid_at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      if (when < start || when > end) continue;
      if (m.session_id) { if (seen.has(m.session_id)) continue; seen.add(m.session_id); }
      if (String(m.region) === 'LA') la += tax; else tn += tax;
      count += 1;
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, tn: Number(tn.toFixed(2)), la: Number(la.toFixed(2)), total: Number((tn + la).toFixed(2)), count }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message, tn: 0, la: 0, total: 0, count: 0 }) };
  }
};
