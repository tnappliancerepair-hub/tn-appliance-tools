// parts-orders-queue — feeds the office "To Order" board. Returns parts orders
// that still need to be placed or are en route, newest first, with the ship-to
// address parsed out so the office can order + drop in tracking.
//
//   GET  -> { ok, to_order:[...], ordered:[...] }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const PARTS_ORDERS = 47;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function parseNotes(n) { try { return JSON.parse(n || '{}'); } catch (_) { return {}; } }

exports.handler = async function () {
  let rows = [];
  try { rows = await crud.searchPage(PARTS_ORDERS, {}, { ordered_at: 'desc' }, 200) || []; } catch (_) {}

  const shape = (r) => {
    const meta = parseNotes(r.notes);
    return {
      order_id: r.id, job_id: r.job_id, part_number: r.part_number, part_name: r.part_name,
      supplier: r.supplier, cost_cents: r.cost_cents, sold_cents: r.sold_to_customer_cents,
      appliance: [r.brand, r.appliance_type].filter(Boolean).join(' '), model: r.model_number,
      status: r.order_status, tracking: r.order_reference || '', eta: r.parts_eta_date || meta.eta || '',
      ship_to: meta.ship_to || 'customer', ship_address: meta.ship_address || '', option_type: meta.option_type || '',
      ordered_at: r.ordered_at,
    };
  };

  const to_order = rows.filter((r) => String(r.order_status) === 'to_order').map(shape);
  const ordered = rows.filter((r) => ['ordered', 'shipped', 'in_transit'].includes(String(r.order_status))).map(shape);

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, to_order, ordered }) };
};
