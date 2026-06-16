// amazon-business-order — place a parts order through Amazon Business, shipped
// to the customer's address. Defaults to TrialMode (validate, no real charge)
// until you pass live:true. Falls back cleanly if Amazon Business isn't enrolled
// yet, so the office just uses the manual one-tap path in the meantime.
//
//   POST { order_id, asin, quantity?, live? }
//   -> { ok, configured, trial, amazon }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const amazon = require('./_lib/amazon-business');

const PARTS_ORDERS = 47;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 120); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const orderId = parseInt(String(b.order_id || '').replace(/\D/g, ''), 10) || 0;
  const asin = s(b.asin, 20);
  if (!orderId || !asin) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'order_id + asin required' }) };

  let order = {}; try { order = await crud.searchOne(PARTS_ORDERS, { id: orderId }) || {}; } catch (_) {}
  let job = {}; try { if (order.job_id) job = await crud.searchOne(crud.TABLES.jobs, { id: order.job_id }) || {}; } catch (_) {}
  let cust = {}; try { if (job.customer_id) cust = await crud.searchOne(crud.TABLES.customer, { id: job.customer_id }) || {}; } catch (_) {}

  const ship = {
    name: [cust.first_name, cust.last_name].filter(Boolean).join(' ') || 'Customer',
    line1: job.service_address || '', city: job.service_city || '', state: job.service_state || '',
    zip: job.service_zip || '', phone: cust.phone || job.phone || '',
  };

  let result;
  try {
    result = await amazon.placeOrder({ asin, quantity: parseInt(b.quantity, 10) || 1, ship, externalId: 'order-' + orderId, poNumber: 'ANT-' + orderId, trial: b.live !== true });
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }

  if (result.configured === false) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, configured: false, note: 'Amazon Business not enrolled yet — use the manual To Order path.' }) };
  }

  // real (non-trial) success → mark the order placed with the Amazon order id
  const amazonOrderId = (result.response && (result.response.orderId || (result.response.acceptanceArtifacts && result.response.acceptanceArtifacts.orderId))) || '';
  if (result.ok && b.live === true) {
    try {
      const meta = (() => { try { return JSON.parse(order.notes || '{}'); } catch (_) { return {}; } })();
      meta.amazon_order_id = amazonOrderId; meta.asin = asin;
      await crud.update(PARTS_ORDERS, orderId, { order_status: 'ordered', supplier: 'amazon', order_reference: amazonOrderId || ('asin:' + asin), notes: JSON.stringify(meta) });
      if (order.job_id) await crud.update(crud.TABLES.jobs, order.job_id, { parts_status: 'awaiting_parts' });
    } catch (_) {}
  }
  await crud.logEvent('amazon_business_order', { order_id: orderId, asin, trial: result.trial, ok: result.ok, status: result.status, amazon_order_id: amazonOrderId, at_ms: Date.now() });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: !!result.ok, configured: true, trial: result.trial, amazon_order_id: amazonOrderId, amazon: result.response }) };
};
