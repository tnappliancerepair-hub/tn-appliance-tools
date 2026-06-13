// Records a customer add-on request from the portal ($10-off offers — supply
// lines, water filter, coil/vent kits, etc.). Writes an event_log row so the
// office gets it and ships the item with the job's parts order. No Xano push.
//
// POST { job_id, addon_key, name, price, discount?, source? }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const b = JSON.parse(event.body || '{}');
    const job_id = parseInt(b.job_id, 10);
    const addon_key = String(b.addon_key || '').trim();
    if (!job_id || !addon_key) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'job_id and addon_key required' }) };
    }
    const price = parseFloat(b.price) || 0;
    const discount = parseFloat(b.discount) || 0;
    const status = String(b.status || 'requested');
    const row = {
      action: status === 'fulfilled' ? 'addon_fulfilled' : 'addon_requested',
      metadata: {
        job_id,
        addon_key,
        name: String(b.name || addon_key),
        price: price.toFixed(2),
        discount: discount.toFixed(2),
        net_price: Math.max(0, price - discount).toFixed(2),
        status: status,
        source: String(b.source || 'customer_portal'),
        requested_at_ms: Date.now(),
      },
    };
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: headers(), body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return { statusCode: 502, body: JSON.stringify({ success: false, error: 'xano ' + r.status, detail: t.slice(0, 160) }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, addon_key, net_price: Math.max(0, price - discount).toFixed(2) }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
