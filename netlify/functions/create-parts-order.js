// create-parts-order — when a customer picks a repair option (or the office adds
// one), create a parts order set to SHIP TO THE CUSTOMER. Lands in the office
// "To Order" queue (parts-orders.html). On order placed, the job goes awaiting_parts
// with an ETA and (for install options) auto-schedules after the part arrives.
//
//   POST { job_id, part_number?, part_name, supplier?, cost_cents?, sold_cents?,
//          option_type?, install?, ship_to? }
//   -> { ok, order_id }

'use strict';
const crud = require('./_lib/xano/metadata-crud');

const PARTS_ORDERS = 47;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 200); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  const partNumber = s(b.part_number, 80) || 'TBD';
  if (!jobId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'job_id required' }) };

  // pull the job for ship-to address + appliance context
  let job = {};
  try { job = await crud.searchOne(crud.TABLES.jobs, { id: jobId }) || {}; } catch (_) {}
  const shipTo = (s(b.ship_to, 12) || 'customer'); // customer | shop
  const install = b.install === true || String(b.install) === 'true';
  const optionType = s(b.option_type, 30) || (install ? 'install' : 'ship_only');
  const addr = [job.service_address, job.service_city, job.service_state, job.service_zip].filter(Boolean).join(', ');
  const notes = JSON.stringify({ ship_to: shipTo, option_type: optionType, install: install, ship_address: shipTo === 'customer' ? addr : 'shop' });

  let orderId = null;
  try {
    const row = await crud.insert(PARTS_ORDERS, {
      job_id: jobId,
      tech_id: job.technician_id || 0,
      part_number: partNumber,
      part_name: s(b.part_name, 120),
      supplier: (s(b.supplier, 40) || 'tbd').toLowerCase(),
      cost_cents: parseInt(b.cost_cents, 10) || 0,
      shipping_cents: 0,
      sold_to_customer_cents: parseInt(b.sold_cents, 10) || 0,
      appliance_type: s(job.appliance_type, 40),
      brand: s(job.brand, 40),
      model_number: s(job.model_number, 60),
      ordered_at: Date.now(),
      order_status: 'to_order',
      order_reference: '',
      source: s(b.source, 30) || 'cash_tdr_pick',
      notes: notes,
    });
    orderId = (row && (row.id || row.order_id)) || null;
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }

  // reflect on the job: needs a part, not schedulable until it arrives
  try { await crud.update(crud.TABLES.jobs, jobId, { parts_status: 'needs_to_order' }); } catch (_) {}
  await crud.logEvent('parts_order_created', { order_id: orderId, job_id: jobId, part_number: partNumber, ship_to: shipTo, option_type: optionType, at_ms: Date.now() });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, order_id: orderId }) };
};
