// mark-parts-ordered — office taps "Ordered" in the To Order queue and drops in
// tracking + ETA. Flips the parts order to 'ordered', stamps tracking, and puts
// the job into awaiting_parts with the ETA so it can't be scheduled before the
// part lands — then auto-surfaces for scheduling on/after the ETA.
//
//   POST { order_id, tracking?, eta_date?, carrier? }   (eta_date = YYYY-MM-DD)
//   -> { ok }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const PARTS_ORDERS = 47;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 120); }
function parseNotes(n) { try { return JSON.parse(n || '{}'); } catch (_) { return {}; } }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const orderId = parseInt(String(b.order_id || '').replace(/\D/g, ''), 10) || 0;
  if (!orderId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'order_id required' }) };

  let order = {};
  try { order = await crud.searchOne(PARTS_ORDERS, { id: orderId }) || {}; } catch (_) {}
  const eta = s(b.eta_date, 20);
  const meta = parseNotes(order.notes); meta.eta = eta; meta.carrier = s(b.carrier, 40);

  try {
    await crud.update(PARTS_ORDERS, orderId, {
      order_status: 'ordered',
      order_reference: s(b.tracking, 80),
      notes: JSON.stringify(meta),
    });
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }

  // put the job into awaiting_parts (+ETA) so it isn't scheduled before arrival,
  // and the ghost scheduler proposes a day on/after the ETA once it's ready.
  const jobId = order.job_id || 0;
  if (jobId) {
    const upd = { parts_status: 'awaiting_parts' };
    if (eta) upd.parts_eta_date = eta;
    try { await crud.update(crud.TABLES.jobs, jobId, upd); } catch (_) {}
  }
  await crud.logEvent('parts_order_placed', { order_id: orderId, job_id: jobId, tracking: s(b.tracking, 80), eta, install: !!meta.install, at_ms: Date.now() });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, job_id: jobId, eta }) };
};
