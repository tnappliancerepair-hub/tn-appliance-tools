// Sums logged expenses (gas / truck / other) for a period for the Money hub
// P&L. Reads event_log action="expense_logged" via the Metadata API.
//
// GET /.netlify/functions/expenses-rollup?start_ms=...&end_ms=...
// -> { success, total, by_category:{gas,truck,other}, count }

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
  const start = parseInt(q.start_ms, 10) || 0;
  const end = parseInt(q.end_ms, 10) || Date.now();
  try {
    const out = [];
    for (let page = 1; page <= 4; page++) {
      const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ search: { action: 'expense_logged' }, sort: { created_at: 'desc' }, per_page: 500, page }),
      });
      if (!r.ok) break;
      const d = await r.json();
      const items = (d && d.items) || [];
      out.push(...items);
      if (items.length < 500) break;
    }
    const by = { gas: 0, truck: 0, other: 0 };
    let total = 0, count = 0;
    for (const row of out) {
      const m = meta(row);
      const t = num(m.expense_date_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      if (t < start || t > end) continue;
      const amt = num(m.amount);
      const cat = (m.category === 'gas' || m.category === 'truck') ? m.category : 'other';
      by[cat] += amt; total += amt; count++;
    }
    return { statusCode: 200, body: JSON.stringify({
      success: true,
      total: Number(total.toFixed(2)),
      by_category: { gas: Number(by.gas.toFixed(2)), truck: Number(by.truck.toFixed(2)), other: Number(by.other.toFixed(2)) },
      count,
    }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message, total: 0, by_category: { gas: 0, truck: 0, other: 0 }, count: 0 }) };
  }
};
