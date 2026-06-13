// Lists add-on / deal-of-the-week requests the customer claimed that the office
// hasn't fulfilled yet (ordered the part / gave the tech time). Reads
// event_log: addon_requested minus addon_fulfilled (keyed job_id+addon_key).
//
// GET /.netlify/functions/addons-pending
// -> { success, count, items:[{job_id,addon_key,name,net_price,source,when}] }

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
  for (let page = 1; page <= 4; page++) {
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

exports.config = { timeout: 26 };

exports.handler = async function () {
  try {
    const [requested, fulfilled] = await Promise.all([
      fetchByAction('addon_requested'),
      fetchByAction('addon_fulfilled'),
    ]);
    const done = new Set();
    for (const f of fulfilled) { const m = meta(f); done.add(m.job_id + '|' + m.addon_key); }
    // de-dupe requests by job+addon, keep latest; drop fulfilled
    const byKey = {};
    for (const r of requested) {
      const m = meta(r);
      const key = m.job_id + '|' + m.addon_key;
      if (done.has(key)) continue;
      const when = Number(m.requested_at_ms) || (r.created_at ? Date.parse(r.created_at) : 0);
      if (!byKey[key] || when > byKey[key].when) {
        byKey[key] = { job_id: m.job_id, addon_key: m.addon_key, name: m.name, net_price: m.net_price || m.price, tech_cut: m.tech_cut || '0.00', mode: m.mode || 'installed', source: m.source || '', when };
      }
    }
    const items = Object.values(byKey).sort((a, b) => b.when - a.when);
    return { statusCode: 200, body: JSON.stringify({ success: true, count: items.length, items }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message, count: 0, items: [] }) };
  }
};
