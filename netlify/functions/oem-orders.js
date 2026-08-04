// oem-orders — office engine for the quote-then-pay OEM parts flow.
// Reads the request worklist, looks up live Marcone cost, prices at 30% margin,
// creates a Stripe pay link + texts/emails it to the customer, and (after they
// pay) drop-ships from Marcone. Office-password gated.
//
// Pricing (Teddy 2026-08-04): part = cost / 0.70 (30% MARGIN), with a cost+$10
// floor under $30; shipping + sales tax are separate line items on top. Sales tax
// only for TN/LA ship addresses (our nexus) — revisit with the CPA as volume grows.
//
//   GET  ?password=            -> { ok, requests:[{request_id, status, ...}] }
//   POST { action:'lookup', password, part_number, make?, zip? }
//        -> live Marcone cost/stock/eta so the office can verify the part
//   POST { action:'quote', password, request_id, part_number, make?, quantity?,
//          item_cost, part_name, ship_to:{name,address1,address2?,city,state,zip},
//          customer_phone?, customer_email? }
//        -> creates the Stripe pay link, texts/emails it, logs oem_quote_sent
//   POST { action:'place',  password, request_id }  -> drop-ship a PAID order
//   POST { action:'decline',password, request_id, reason? }
'use strict';

const Stripe = require('stripe');
const crud = require('./_lib/xano/metadata-crud');
const msupply = require('./_lib/msupply');
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG = 3;
const TAX_RATE = { TN: 0.0975, LA: 0.0945 };   // nexus states only
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const s = (v) => String(v == null ? '' : v).trim();
function metaOf(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// 30% MARGIN on the part; small-part flat floor. Shipping + tax added separately.
function partPrice(costDollars) {
  const cost = Number(costDollars) || 0;
  if (cost <= 0) return 0;
  if (cost < 30) return round2(cost + 10);
  return round2(cost / 0.70);
}
function taxFor(state, taxableDollars) {
  const st = String(state || '').trim().toUpperCase();
  const rate = TAX_RATE[st] || 0;
  return { rate, cents: Math.round((Number(taxableDollars) || 0) * rate * 100) };
}

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

// Build the worklist: newest event per request_id wins for status; carry the
// original request fields + the latest quote/payment/tracking.
async function loadWorklist() {
  const actions = ['oem_part_request', 'oem_quote_sent', 'oem_order_paid', 'oem_order_placed', 'oem_declined'];
  const rows = [];
  for (const action of actions) {
    try {
      const r = await crud.searchPage(EVENT_LOG, { action }, { created_at: 'desc' }, 400);
      for (const row of (r || [])) rows.push({ action, m: metaOf(row), created_at: row.created_at });
    } catch (_) {}
  }
  const byId = {};
  // requests first (base record)
  for (const e of rows) {
    if (e.action !== 'oem_part_request') continue;
    const id = e.m.request_id; if (!id || byId[id]) continue;
    byId[id] = { request_id: id, status: 'requested', requested_at: e.created_at, ...e.m };
  }
  // overlay the rest (newest-first, first wins per field group)
  const stamp = { oem_quote_sent: 'quoted', oem_order_paid: 'paid', oem_order_placed: 'placed', oem_declined: 'declined' };
  const rank = { requested: 0, quoted: 1, paid: 2, placed: 3, declined: 3 };
  for (const e of rows) {
    const id = e.m.request_id; if (!id || !byId[id]) continue;
    const st = stamp[e.action]; if (!st) continue;
    const rec = byId[id];
    // keep the highest-progress status; but 'placed'/'declined' are terminal
    if ((rank[st] || 0) >= (rank[rec.status] || 0)) rec.status = st;
    if (e.action === 'oem_quote_sent' && !rec.quote) rec.quote = e.m;
    if (e.action === 'oem_order_paid' && !rec.paid) rec.paid = e.m;
    if (e.action === 'oem_order_placed' && !rec.placed) rec.placed = e.m;
    if (e.action === 'oem_declined' && !rec.declined) rec.declined = e.m;
  }
  return Object.values(byId).sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  const qp = event.queryStringParameters || {};
  let b = {};
  if (event.body) { try { b = JSON.parse(event.body); } catch (_) {} }
  const password = s(b.password || qp.password);
  if (!(await verifyOffice(password))) return j(401, { ok: false, error: 'office password required' });

  // ── list the worklist ──
  if (event.httpMethod === 'GET' || (b.action || '') === 'list') {
    const requests = await loadWorklist();
    return j(200, { ok: true, count: requests.length, requests });
  }

  const action = s(b.action);

  // ── live Marcone cost/stock lookup (office verification helper) ──
  if (action === 'lookup') {
    const part = s(b.part_number);
    if (!part) return j(400, { ok: false, error: 'part_number required' });
    try {
      const p = await msupply.lookupPart(part, s(b.make) || undefined, { zip: s(b.zip) || undefined });
      if (!p.ok) return j(200, { ok: false, error: p.error || 'lookup_failed' });
      return j(200, { ok: true, part_number: p.part_number, description: p.description, make: p.make,
        cost: p.cost, in_stock: p.in_stock, total_qty: p.total_qty, eta_days: p.eta_days,
        discontinued: p.discontinued, drop_ship_only: p.drop_ship_only, hazmat: p.hazmat,
        suggested_price: partPrice(p.cost) });
    } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
  }

  // ── quote: price it, make the Stripe pay link, send it ──
  if (action === 'quote') {
    const requestId = s(b.request_id);
    const partNumber = s(b.part_number);
    const make = s(b.make);
    const qty = Math.max(1, Number(b.quantity) || 1);
    const partName = s(b.part_name) || partNumber;
    const cost = Number(b.item_cost) || 0;
    const ship = b.ship_to || {};
    const shipTo = { name: s(ship.name), address1: s(ship.address1 || ship.address), address2: s(ship.address2),
      city: s(ship.city), state: s(ship.state).toUpperCase(), zip: s(ship.zip) };
    const phone = s(b.customer_phone).replace(/[^\d+]/g, '');
    const email = s(b.customer_email);

    if (!requestId || !partNumber) return j(400, { ok: false, error: 'request_id and part_number required' });
    if (cost <= 0) return j(400, { ok: false, error: 'item_cost required (look it up first)' });
    for (const k of ['name', 'address1', 'city', 'state', 'zip']) if (!shipTo[k]) return j(400, { ok: false, error: 'ship_to.' + k + ' required' });
    if (!phone && !email) return j(400, { ok: false, error: 'a phone or email to send the pay link' });

    const partCents = Math.round(partPrice(cost) * qty * 100);
    const shipDollars = Number(await getSecretFresh('OEM_SHIP_FEE')) || 12.95;
    const shipCents = Math.round(shipDollars * 100);
    const tax = taxFor(shipTo.state, (partCents + shipCents) / 100);
    const totalCents = partCents + shipCents + tax.cents;

    const key = await getSecret('STRIPE_SECRET_KEY');
    if (!key) return j(200, { ok: false, error: 'stripe_not_configured' });

    let session;
    try {
      const stripe = new Stripe(key);
      const line_items = [
        { price_data: { currency: 'usd', product_data: { name: 'OEM part: ' + partName + (partNumber ? ' (' + partNumber + ')' : '') }, unit_amount: Math.round(partPrice(cost) * 100) }, quantity: qty },
        { price_data: { currency: 'usd', product_data: { name: 'Shipping to your door' }, unit_amount: shipCents }, quantity: 1 },
      ];
      if (tax.cents > 0) line_items.push({ price_data: { currency: 'usd', product_data: { name: 'Sales tax (' + shipTo.state + ' ' + (tax.rate * 100).toFixed(2) + '%)' }, unit_amount: tax.cents }, quantity: 1 });
      session = await stripe.checkout.sessions.create({
        mode: 'payment', line_items,
        success_url: 'https://tnapplianceexchange.net/pay-thanks.html?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://applianceant.com/order-oem',
        customer_email: email || undefined,
        metadata: {
          kind: 'oem_part', request_id: requestId, part_number: partNumber, make: make,
          quantity: String(qty), part_name: partName.slice(0, 300),
          item_cost_cents: String(Math.round(cost * 100)), base_cents: String(partCents),
          ship_cents: String(shipCents), tax_cents: String(tax.cents), region: shipTo.state,
          amount_cents: String(totalCents),
          ship_name: shipTo.name.slice(0, 120), ship_address1: shipTo.address1.slice(0, 200), ship_address2: shipTo.address2.slice(0, 120),
          ship_city: shipTo.city.slice(0, 80), ship_state: shipTo.state, ship_zip: shipTo.zip,
          customer_phone: phone, customer_email: email.slice(0, 120), source: 'oem_quote',
        },
      });
    } catch (e) { return j(200, { ok: false, error: 'stripe: ' + String((e && e.message) || e) }); }

    await crud.logEvent('oem_quote_sent', {
      request_id: requestId, part_number: partNumber, make, quantity: qty, part_name: partName,
      item_cost: round2(cost), part_price: partPrice(cost), part_cents: partCents, ship_cents: shipCents,
      tax_cents: tax.cents, tax_rate: tax.rate, total_cents: totalCents, region: shipTo.state,
      ship_to: shipTo, customer_phone: phone, customer_email: email,
      session_id: session.id, pay_url: session.url, at_ms: Date.now(),
    });

    // Send the pay link to the customer.
    const total = '$' + (totalCents / 100).toFixed(2);
    const msg = 'TN Appliance / Appliance Ant: your ' + partName + ' is ready to order — ' + total
      + ' shipped to your door. Pay here and we ship it out: ' + session.url
      + '  (Genuine OEM part; carries the manufacturer\'s warranty.)';
    let sent = [];
    if (phone) { const to = phone.replace(/[^\d]/g, ''); const e164 = to.length === 10 ? '+1' + to : (to.length === 11 ? '+' + to : phone); try { await sendSms(e164, msg, 'customer', 'oem_quote'); sent.push('sms'); } catch (_) {} }
    // (Email send would go here when SES is wired; the link is also shown to the office to send manually.)

    return j(200, { ok: true, request_id: requestId, pay_url: session.url, session_id: session.id,
      part_price: partPrice(cost), ship: shipDollars, tax_cents: tax.cents, total_cents: totalCents, sent });
  }

  // ── place: drop-ship a PAID order from Marcone ──
  if (action === 'place') {
    const requestId = s(b.request_id);
    if (!requestId) return j(400, { ok: false, error: 'request_id required' });
    const list = await loadWorklist();
    const rec = list.find((r) => r.request_id === requestId);
    if (!rec) return j(404, { ok: false, error: 'request not found' });
    if (rec.status !== 'paid') return j(400, { ok: false, error: 'not paid yet (status: ' + rec.status + ')' });
    if (rec.placed) return j(200, { ok: true, already: true, order_numbers: rec.placed.order_numbers });
    const q = rec.quote || {};
    const ship = q.ship_to || {};
    // Forward to marcone-order (it holds the ship-method + cart logic + office guard).
    const base = process.env.URL || 'https://tnapplianceexchange.net';
    let out;
    try {
      const r = await fetch(base + '/.netlify/functions/marcone-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'place', password, confirm: true,
          part_number: q.part_number, make: q.make || undefined, quantity: q.quantity || 1,
          ship_to: ship, po_number: requestId, notes: 'Appliance Ant DIY drop-ship' }),
        signal: AbortSignal.timeout(25000),
      });
      out = await r.json().catch(() => ({}));
    } catch (e) { return j(200, { ok: false, error: 'marcone: ' + String((e && e.message) || e) }); }
    if (!out || !out.ok) return j(200, { ok: false, error: (out && out.error) || 'place_failed', detail: out });

    await crud.logEvent('oem_order_placed', { request_id: requestId, part_number: q.part_number,
      order_numbers: out.order_numbers || out.order_number || null, status: out.status || 'placed', at_ms: Date.now() });

    // Tell the customer it shipped.
    const phone = String(q.customer_phone || '').replace(/[^\d]/g, '');
    if (phone) { const e164 = phone.length === 10 ? '+1' + phone : (phone.length === 11 ? '+' + phone : q.customer_phone);
      try { await sendSms(e164, 'TN Appliance / Appliance Ant: your ' + (q.part_name || 'part') + ' is on the way! We\'ll follow up with tracking. It carries the manufacturer\'s warranty — thanks for letting us help. 🐜', 'customer', 'oem_shipped'); } catch (_) {} }
    return j(200, { ok: true, request_id: requestId, order_numbers: out.order_numbers, status: out.status });
  }

  // ── decline ──
  if (action === 'decline') {
    const requestId = s(b.request_id);
    if (!requestId) return j(400, { ok: false, error: 'request_id required' });
    await crud.logEvent('oem_declined', { request_id: requestId, reason: s(b.reason) || 'declined', at_ms: Date.now() });
    return j(200, { ok: true, request_id: requestId });
  }

  return j(400, { ok: false, error: 'unknown action' });
};
