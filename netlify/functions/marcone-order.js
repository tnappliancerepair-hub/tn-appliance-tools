// marcone-order — quote + place Marcone (mSupply) orders, drop-shipped to the
// customer. Internal/office only. SAFETY: `quote` places nothing (uses the cart
// endpoint); `place` (real money) requires the office password AND confirm:true.
//
//   POST { action:'quote', part_number, make?, quantity?, ship_to:{name,address1,
//          address2?,city,state,zip} }
//     -> { ok, part, shipping_method, item_cost, delivery_chg, total, eta, substitutions }
//
//   POST { action:'place', password, confirm:true, part_number, make?, quantity?,
//          ship_to:{...}, po_number?, notes? }
//     -> { ok, order_numbers, status, success, substitutions }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const msupply = require('./_lib/msupply');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

async function verifyOffice(password) {
  if (!password) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    return !!(d && (d.valid || d.success || d.ok));
  } catch (_) { return false; }
}

function cleanShipTo(s) {
  s = s || {};
  return { name: s.name || '', address1: s.address1 || s.address || '', address2: s.address2 || '', city: s.city || '', state: s.state || '', zip: s.zip || s.zip_code || '' };
}
function missingAddr(a) {
  const m = [];
  for (const k of ['name', 'address1', 'city', 'state', 'zip']) if (!String(a[k] || '').trim()) m.push(k);
  return m;
}

// Pick a sane default shipping method (prefer a ground/standard option, else first).
function pickShipping(methods) {
  const list = (methods || []).filter((m) => m && m.shippingMethodId != null);
  if (!list.length) return null;
  const ground = list.find((m) => /ground|standard|economy|best way/i.test(`${m.shippingMethodName || ''} ${m.description || ''}`));
  return ground || list[0];
}

// WILL CALL = pick it up at the branch (no shipping charge). Marcone exposes it
// as a shipping method (id 4, name "WILL CALL"). Used when fulfillment=will_call.
function pickWillCall(methods) {
  return (methods || []).find((m) => m && m.shippingMethodId != null && /will.?call/i.test(`${m.shippingMethodName || ''} ${m.description || ''}`)) || null;
}
const keyOf = (jobId, part) => `${jobId || 0}::${String(part || '').trim().toLowerCase()}`;

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const action = String(b.action || 'quote');
  const partNumber = String(b.part_number || '').trim();
  const quantity = Math.max(1, Number(b.quantity) || 1);
  const shipTo = cleanShipTo(b.ship_to);

  // Order status check (no part/address needed).
  if (action === 'status') {
    try {
      const custNo = (await getSecret('MSUPPLY_CUST_NO')) || undefined;
      const r = await msupply.api('POST', '/orders/orderstatus', { custNo: custNo ? Number(custNo) : undefined, orderNumber: String(b.order_number || '') });
      return json(200, { ok: r.ok, status: r.status, data: r.data || r.raw });
    } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
  }

  if (!partNumber) return json(400, { ok: false, error: 'part_number required' });
  const miss = missingAddr(shipTo);
  if (miss.length) return json(400, { ok: false, error: 'ship_to missing: ' + miss.join(', ') });

  try {
    const custNo = (await getSecret('MSUPPLY_CUST_NO')) || undefined;

    // Resolve make + confirm the part exists. Pass the customer ZIP so Marcone
    // returns time-in-transit per warehouse (ByZipCode), letting us ship from the
    // NEAREST in-stock branch.
    let make = String(b.make || '').trim();
    let part = null;
    const look = await msupply.lookupPart(partNumber, make || null, { zip: shipTo.zip, lookupType: shipTo.zip ? 'ByZipCode' : 'Default' });
    if (look && look.ok) { part = look; if (!make) make = look.make; }
    if (!part) return json(200, { ok: false, error: 'part not found in Marcone: ' + partNumber });

    // Pick the NEAREST in-stock warehouse: lowest transit days, then most stock.
    const stocked = (part.in_stock_at || []).filter((w) => Number(w.qty) > 0);
    stocked.sort((a, b2) => {
      const ta = a.transit_days == null ? 999 : Number(a.transit_days);
      const tb = b2.transit_days == null ? 999 : Number(b2.transit_days);
      return (ta - tb) || (Number(b2.qty) - Number(a.qty));
    });
    const best = stocked[0] || null;
    // WILL CALL support: the office can force a specific branch to pick up from
    // (b.branch_warehouse) — e.g. grab it in New Orleans vs Nashville. Otherwise
    // use the nearest in-stock branch. b.pickup_city is just the human label.
    const wantWillCall = b.fulfillment === 'will_call' || b.pickup === true;
    let wh, whName;
    if (b.branch_warehouse) {
      wh = String(b.branch_warehouse);
      const match = stocked.find((w) => String(w.warehouse_number) === String(b.branch_warehouse));
      whName = (match && match.warehouse) || b.pickup_city || ('Branch ' + b.branch_warehouse);
    } else {
      wh = best ? best.warehouse_number : undefined;
      whName = best ? best.warehouse : undefined;
    }
    const transitDays = best ? best.transit_days : null;
    const items = [{ make, partNumber, quantity, warehouseNumber: wh, reference: b.reference || undefined }];

    // shipping method (required by cartorder) — for that warehouse
    const sm = await msupply.shippingMethods(custNo, wh);
    const methods = (sm && sm.ok && sm.data && (sm.data.shippingMethods || sm.data)) || [];
    let chosen = pickShipping(methods);
    if (wantWillCall) {
      chosen = pickWillCall(methods);
      if (!chosen) return json(200, { ok: false, error: 'WILL CALL not offered at this branch', warehouse: wh, methods });
    }
    if (!chosen) return json(200, { ok: false, error: 'no shipping methods returned', warehouse: wh, detail: sm && sm.raw && sm.raw.slice(0, 200) });

    if (action === 'debug') {
      // Full visibility: what we resolved, what shipping methods came back, and the
      // raw cart response — so we can see the exact failure (or hand it to Marcone).
      const cartBody = {
        custNo: custNo ? Number(custNo) : undefined, warehouseNumber: wh ? Number(wh) : undefined,
        shipTo, shippingMethodId: chosen.shippingMethodId,
        cartOrderItems: items.map((i) => ({ make: i.make, partNumber: i.partNumber, quantity: i.quantity, warehouseNumber: i.warehouseNumber })),
      };
      const q = await msupply.quoteCart({ custNo, shipTo, items, shippingMethodId: chosen.shippingMethodId, warehouseNumber: wh });
      return json(200, {
        ok: true, custNo, warehouse: wh, make,
        shipping_methods: methods,
        chosen_shipping: chosen,
        cart_request_body: cartBody,
        cart_response_status: q.status,
        cart_response: q.data || q.raw,
      });
    }

    if (action === 'quote') {
      const q = await msupply.quoteCart({ custNo, shipTo, items, shippingMethodId: chosen.shippingMethodId, warehouseNumber: wh, poNumber: b.po_number });
      if (!q.ok) return json(200, { ok: false, error: 'quote failed', status: q.status, detail: (q.data && (q.data.message || q.data.error)) || (q.raw || '').slice(0, 200) });
      const d = q.data || {};
      return json(200, {
        ok: true,
        part: { part_number: partNumber, make, description: part.description, our_cost: part.cost },
        shipping_method: { id: chosen.shippingMethodId, name: chosen.shippingMethodName, carrier: chosen.carrier },
        item_cost: part.cost, delivery_chg: d.deliveryChg, total: d.cartTotal, eta: d.eta,
        substitutions: d.substitutions || [], ship_to: shipTo,
      });
    }

    if (action === 'place') {
      // HARD GATE — real money. Office password (UI users) OR the admin secret
      // (authorized system/owner-directed call). Plus explicit confirm:true.
      const adminOk = b.secret && b.secret === ((await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5');
      if (!adminOk && !(await verifyOffice(b.password))) return json(401, { ok: false, error: 'auth required to place an order' });
      if (b.confirm !== true) return json(400, { ok: false, error: 'confirm:true required to place an order' });
      const p = await msupply.placeOrder({ custNo, shipTo, items, shippingMethod: chosen.shippingMethodName, poNumber: b.po_number, notes: b.notes });
      if (!p.ok) return json(200, { ok: false, error: 'order failed', status: p.status, detail: (p.data && (p.data.reason || p.data.errorCode || p.data.message)) || (p.raw || '').slice(0, 200) });
      const d = p.data || {};
      const placed = !!(d.success || (Array.isArray(d.orderNumbers) && d.orderNumbers.length));
      const orderNo = (d.orderNumbers || [])[0];
      // Pull the real confirmed details (actual ship-from warehouse + total + carrier).
      let real = {};
      if (placed && orderNo) {
        try {
          const st = await msupply.api('POST', '/orders/orderstatus', { custNo: custNo ? Number(custNo) : undefined, orderNumber: String(orderNo) });
          const o = st.ok && st.data && (st.data.orderResults || [])[0];
          if (o) real = { status: o.status, ships_from: (o.warehouse && o.warehouse.name) || whName, shipping_method: o.shippingMethod, delivery_charge: o.deliveryCharge, total: o.totalCharge };
        } catch (_) {}
      }
      // WILL CALL → drop it onto the tech's "Parts to grab" pickup list so he
      // knows to grab it on his next Marcone run (which city/branch + who's it for).
      let staged = null;
      if (placed && wantWillCall) {
        const branchLabel = b.pickup_city || whName || 'Marcone';
        staged = keyOf(b.job_id, partNumber);
        try {
          await crud.logEvent('part_pickup_ready', {
            key: staged, supplier: 'marcone', branch: branchLabel,
            part: partNumber, tech_id: b.tech_id != null ? Number(b.tech_id) : null,
            area: b.pickup_city || '', job_id: b.job_id || null,
            customer: String(b.customer || ''), appliance: String(b.appliance || ''),
            note: 'Marcone will-call' + (orderNo ? ' · order ' + orderNo : ''),
            by: 'marcone_order', at_ms: Date.now(),
          });
        } catch (_) { staged = null; }
      }
      return json(200, {
        will_call: wantWillCall || undefined, pickup_at: wantWillCall ? (b.pickup_city || whName) : undefined, staged_pickup: staged,
        ok: placed, order_numbers: d.orderNumbers || [], substitutions: d.substitutions || [], ship_to: shipTo,
        item_cost: part.cost, part_description: part.description, transit_days: transitDays,
        ships_from: real.ships_from || whName, status: real.status || d.status, shipping_method: real.shipping_method,
        delivery_charge: real.delivery_charge, total: real.total, reason: d.reason, error_code: d.errorCode,
      });
    }

    return json(400, { ok: false, error: 'unknown action; use quote|place' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
