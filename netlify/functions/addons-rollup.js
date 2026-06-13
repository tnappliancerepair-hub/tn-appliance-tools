// Add-on program rollup for a pay period — feeds the owner P&L + a summary.
// Reads event_log addon_fulfilled rows in [start_ms,end_ms], de-dupes per
// job+addon, and returns revenue (what the customer pays), tech cut, part cost,
// and the shop margin (revenue - tech cut - part cost).
//
// GET /.netlify/functions/addons-rollup?start_ms=..&end_ms=..
// -> { success, count, revenue, tech_cut, part_cost, margin,
//      installed:{count,revenue}, ship:{count,revenue} }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
async function fetchByAction(action) {
  const out = [];
  for (let page = 1; page <= 6; page++) {
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
  const start = Number(q.start_ms) || 0;
  const end = Number(q.end_ms) || Date.now();
  try {
    const rows = await fetchByAction('addon_fulfilled');
    const seen = new Set();
    let revenue = 0, tech_cut = 0, part_cost = 0, count = 0;
    const installed = { count: 0, revenue: 0 }, ship = { count: 0, revenue: 0 };
    for (const row of rows) {
      const m = meta(row);
      const when = num(m.requested_at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      if (when < start || when > end) continue;
      const key = m.job_id + '|' + m.addon_key;
      if (seen.has(key)) continue;
      seen.add(key);
      const net = num(m.net_price || m.price);
      const cut = num(m.tech_cut);
      const cost = num(m.cost);
      revenue += net; tech_cut += cut; part_cost += cost; count += 1;
      if (m.mode === 'ship') { ship.count += 1; ship.revenue += net; }
      else { installed.count += 1; installed.revenue += net; }
    }
    const margin = revenue - tech_cut - part_cost;
    const r2 = (n) => Number(n.toFixed(2));
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true, count,
        revenue: r2(revenue), tech_cut: r2(tech_cut), part_cost: r2(part_cost), margin: r2(margin),
        installed: { count: installed.count, revenue: r2(installed.revenue) },
        ship: { count: ship.count, revenue: r2(ship.revenue) },
      }),
    };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message, count: 0, revenue: 0, tech_cut: 0, part_cost: 0, margin: 0 }) };
  }
};
