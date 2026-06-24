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

    // Resolve make + confirm the part exists (Marcone make is a code, e.g. WPL).
    let make = String(b.make || '').trim();
    let part = null;
    const look = await msupply.lookupPart(partNumber, make || null, {});
    if (look && look.ok) { part = look; if (!make) make = look.make; }
    if (!part) return json(200, { ok: false, error: 'part not found in Marcone: ' + partNumber });

    // Ship from the part's first in-stock warehouse — shipping methods + cart
    // appear to be warehouse-specific.
    const wh = (part.in_stock_at && part.in_stock_at[0] && part.in_stock_at[0].warehouse_number) || undefined;
    const items = [{ make, partNumber, quantity, warehouseNumber: wh, reference: b.reference || undefined }];

    // shipping method (required by cartorder) — for that warehouse
    const sm = await msupply.shippingMethods(custNo, wh);
    const methods = (sm && sm.ok && sm.data && (sm.data.shippingMethods || sm.data)) || [];
    const chosen = pickShipping(methods);
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
      return json(200, { ok: placed, order_numbers: d.orderNumbers || [], status: d.status, reason: d.reason, error_code: d.errorCode, substitutions: d.substitutions || [], ship_to: shipTo });
    }

    return json(400, { ok: false, error: 'unknown action; use quote|place' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
