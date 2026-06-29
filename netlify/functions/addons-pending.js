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

exports.handler = async function (event) {
  try {
    const jobFilter = (event && event.queryStringParameters && event.queryStringParameters.job_id)
      ? String(event.queryStringParameters.job_id) : '';
    const [requested, fulfilled, voided, acknowledged] = await Promise.all([
      fetchByAction('addon_requested'),
      fetchByAction('addon_fulfilled'),
      fetchByAction('addon_voided'),
      fetchByAction('addon_acknowledged'),
    ]);
    const done = new Set();
    for (const f of fulfilled) { const m = meta(f); done.add(m.job_id + '|' + m.addon_key); }
    // voided = customer added it by mistake, tech/office took it back off — drop it
    for (const v of voided) { const m = meta(v); done.add(m.job_id + '|' + m.addon_key); }
    // acknowledged = office X'd it off the banner (figured out what's going on) —
    // drop from the to-fulfill list but it STAYS on the job ticket (addons-for-job).
    for (const a of acknowledged) { const m = meta(a); done.add(m.job_id + '|' + m.addon_key); }
    // de-dupe requests by job+addon, keep latest; drop fulfilled
    const byKey = {};
    for (const r of requested) {
      const m = meta(r);
      const key = m.job_id + '|' + m.addon_key;
      if (done.has(key)) continue;
      const when = Number(m.requested_at_ms) || (r.created_at ? Date.parse(r.created_at) : 0);
      if (!byKey[key] || when > byKey[key].when) {
        byKey[key] = { job_id: m.job_id, addon_key: m.addon_key, name: m.name, net_price: m.net_price || m.price, tech_cut: m.tech_cut || '0.00', mode: m.mode || 'installed', paid: !!m.paid, source: m.source || '', when };
      }
    }
    let items = Object.values(byKey).sort((a, b) => b.when - a.when);
    if (jobFilter) items = items.filter((x) => String(x.job_id) === jobFilter);
    return { statusCode: 200, body: JSON.stringify({ success: true, count: items.length, items }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message, count: 0, items: [] }) };
  }
};
