// Returns every add-on attached to ONE job that should be BILLED — i.e. the
// customer requested it (and a tech may have already done it / office fulfilled
// it), but it was NOT voided (tapped by mistake + removed). Used by the office
// invoice worksheet so an add-on still shows on the bill after the tech taps
// "Confirm & done" (which marks it fulfilled and drops it from addons-pending).
//
// GET /.netlify/functions/addons-for-job?job_id=123
// -> { success, count, total, items:[{addon_key,name,net_price,status,...}] }

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
  const jobFilter = (event && event.queryStringParameters && event.queryStringParameters.job_id)
    ? String(event.queryStringParameters.job_id) : '';
  if (!jobFilter) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'job_id required' }) };
  try {
    const [requested, fulfilled, voided] = await Promise.all([
      fetchByAction('addon_requested'),
      fetchByAction('addon_fulfilled'),
      fetchByAction('addon_voided'),
    ]);
    const voidedKeys = new Set();
    for (const v of voided) { const m = meta(v); voidedKeys.add(m.job_id + '|' + m.addon_key); }
    // Merge requested + fulfilled; dedupe by job+addon, keep latest; drop voided.
    const byKey = {};
    for (const r of [...requested, ...fulfilled]) {
      const m = meta(r);
      if (String(m.job_id) !== jobFilter) continue;
      const key = m.job_id + '|' + m.addon_key;
      if (voidedKeys.has(key)) continue;
      const when = Number(m.requested_at_ms) || (r.created_at ? Date.parse(r.created_at) : 0);
      const rowPrice = parseFloat(m.net_price || m.price) || 0;
      const fulfilledNow = (r.action === 'addon_fulfilled') || (byKey[key] && byKey[key].fulfilled);
      const paidNow = !!m.paid || (byKey[key] && byKey[key].paid);
      if (!byKey[key] || when > byKey[key].when) {
        // carry the best non-zero price forward (the office "Ordered ✓" fulfill row
        // has no price; the requested row holds the real one)
        const prevPrice = byKey[key] ? (parseFloat(byKey[key].net_price) || 0) : 0;
        byKey[key] = {
          job_id: m.job_id, addon_key: m.addon_key, name: m.name || (byKey[key] && byKey[key].name),
          net_price: (rowPrice > 0 ? rowPrice : prevPrice).toFixed(2),
          tech_cut: m.tech_cut || (byKey[key] && byKey[key].tech_cut) || '0.00',
          mode: m.mode || 'installed', status: m.status || r.action,
          fulfilled: !!fulfilledNow, paid: !!paidNow, pay_method: m.pay_method || (byKey[key] && byKey[key].pay_method) || '', when,
        };
      } else {
        if (rowPrice > (parseFloat(byKey[key].net_price) || 0)) byKey[key].net_price = rowPrice.toFixed(2);
        if (fulfilledNow) byKey[key].fulfilled = true;
        if (paidNow) { byKey[key].paid = true; if (m.pay_method) byKey[key].pay_method = m.pay_method; }
      }
    }
    const items = Object.values(byKey).sort((a, b) => b.when - a.when);
    const total = items.reduce((s, x) => s + (parseFloat(x.net_price) || 0), 0);
    // unpaid_total = what the office invoice should ADD (paid add-ons are already
    // collected via Stripe/cash and must not be re-billed on the job invoice).
    const unpaidTotal = items.filter((x) => !x.paid).reduce((s, x) => s + (parseFloat(x.net_price) || 0), 0);
    return { statusCode: 200, body: JSON.stringify({ success: true, count: items.length, total: total.toFixed(2), unpaid_total: unpaidTotal.toFixed(2), items }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message, count: 0, total: '0.00', items: [] }) };
  }
};
