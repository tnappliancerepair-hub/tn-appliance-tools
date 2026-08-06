// parts-beat-tech-order — the office ONE-TAP "order the part to beat the tech" action.
// Decisions locked 2026-08-06: (1) office one-tap approve, (2) HUMAN-picked part only,
// (3) order anyway + flag office to move the day if the ETA misses the visit,
// (4) warranty handled elsewhere (alert/push) — NEVER ordered here.
//
// Flow: office taps -> this validates (cash + human part + not already ordered), pulls
// the live Marcone ETA, and (LIVE) drop-ships the part to the customer's home via the
// proven marcone-order placer, logging a ledger row. If the part can't beat the visit it
// orders anyway and flags the office to reschedule.
//
// SAFETY (real money to a customer's home): SHADOW by default — returns exactly what it
// WOULD order, buys nothing. Flip vault PARTS_BEAT_TECH_LIVE=true to place for real.
//   POST { job_id, password? , secret? }   (office password OR admin secret)
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const msupply = require('./_lib/msupply');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const PARTS_ORDERS = 47;
const CASH = new Set(['self_pay', 'cash', 'customer_pay', 'self pay']);
const BUFFER_DAYS = 1;
exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function dayMs(v) { const t = typeof v === 'number' ? v : Date.parse(String(v || '')); return isFinite(t) ? t : 0; }
async function getJSON(url, opts, ms) {
  ms = ms || 8000;
  const f = fetch(url, Object.assign({ signal: AbortSignal.timeout(ms) }, opts || {})).then((r) => r.json()).catch(() => null);
  const t = new Promise((res) => setTimeout(() => res(null), ms + 200));
  return Promise.race([f, t]);
}
async function verifyOffice(password) {
  if (!password) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false; const d = await r.json().catch(() => ({})); return !!(d && (d.ok || d.valid || d.authorized || d === true));
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });

  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const adminOk = b.secret && b.secret === admin;
  if (!adminOk && !(await verifyOffice(b.password))) return json(401, { ok: false, error: 'unauthorized' });

  if (String(await getSecret('PARTS_BEAT_TECH') || '').toLowerCase() === 'false') return json(200, { ok: false, error: 'disabled' });
  const live = ['on', 'true', '1'].includes(String(await getSecretFresh('PARTS_BEAT_TECH_LIVE') || '').trim().toLowerCase());

  // Resolve job (customer_type + scheduled + brand + customer) and the human-picked part.
  const [dash, ctx] = await Promise.all([
    getJSON(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }) }),
    getJSON(`${XANO}/get_warranty_submission_context?job_id=${jobId}`),
  ]);
  const job = (dash && dash.job) || {};
  const cust = (ctx && ctx.customer) || (dash && dash.customer) || {};
  const ct = String(job.customer_type || (dash && dash.customer && dash.customer.customer_type) || '').toLowerCase();

  // FORK: cash only. Warranty parts are vendor-supplied — never order them here.
  if (!CASH.has(ct)) return json(200, { ok: false, error: 'warranty_excluded', note: 'Vendor supplies warranty parts — not ordered here.' });

  // Confidence gate: a HUMAN-picked part (Teddy Tool oem_part_number) only.
  const f = ((ctx && ctx.tdr_failures) || []).find((x) => x.oem_part_number);
  const part = (f && String(f.oem_part_number || '').trim()) || '';
  if (!part) return json(200, { ok: false, error: 'no_human_part', note: 'Needs a human-picked OEM part # on the TDR before we order.' });

  // Dedup: already has a parts order?
  try { const ex = await crud.searchPage(PARTS_ORDERS, { job_id: jobId }, { id: 'desc' }, 3); if (ex && ex.length) return json(200, { ok: false, error: 'already_ordered' }); } catch (_) {}

  // Ship-to (customer home).
  const shipTo = {
    name: [cust.first_name, cust.last_name].filter(Boolean).join(' ') || cust.full_name || 'Customer',
    address1: cust.address_line1 || cust.address || job.service_address || '',
    city: cust.city || job.service_city || '', state: cust.state || job.service_state || '',
    zip: cust.zip || cust.zip_code || job.service_zip || '', phone: String(cust.phone || '').replace(/\D/g, ''),
  };
  if (!shipTo.address1 || !shipTo.zip) return json(200, { ok: false, error: 'no_ship_address' });

  // Live Marcone ETA -> beats the visit?
  const brand = job.brand || (dash && dash.appliance && dash.appliance.brand) || '';
  let etaDays = null, inStock = null;
  try { const r = await msupply.lookupPart(part, brand, { zip: shipTo.zip.slice(0, 5) }); if (r && r.ok) { etaDays = r.eta_days; inStock = !!r.in_stock; } } catch (_) {}
  const visitMs = dayMs(job.scheduled_start);
  let beats = null;
  if (etaDays != null && visitMs) beats = (etaDays + BUFFER_DAYS) <= Math.round((visitMs - Date.now()) / 86400000);

  const plan = { job_id: jobId, part, brand, in_stock: inStock, eta_days: etaDays, scheduled: job.scheduled_start || null, beats_visit: beats, ship_to_city: shipTo.city, who: shipTo.name };

  if (!live) return json(200, { ok: true, mode: 'shadow', would_order: plan, note: 'SHADOW — nothing bought. Flip PARTS_BEAT_TECH_LIVE=true to place for real.' });

  // LIVE: place the drop-ship to the customer via the proven Marcone placer.
  let res;
  try {
    res = await fetch('https://tnapplianceexchange.net/.netlify/functions/marcone-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'place', secret: admin, confirm: true, part_number: part, make: brand || undefined, quantity: 1, ship_to: shipTo, notes: 'Beat-the-tech drop-ship · job #' + jobId }),
      signal: AbortSignal.timeout(25000),
    }).then((x) => x.json());
  } catch (e) { return json(200, { ok: false, error: 'place_error', detail: String((e && e.message) || e) }); }
  if (!res || !res.ok) return json(200, { ok: false, error: 'marcone_declined', detail: (res && res.error) || 'unknown' });

  const orderRef = res.order_number || res.order_id || res.po || '';
  try {
    await crud.insert(PARTS_ORDERS, {
      job_id: jobId, tech_id: job.technician_id || 0, part_number: part, part_name: (f && f.failed_component) || '',
      supplier: 'marcone', cost_cents: 0, shipping_cents: 0, sold_to_customer_cents: 0,
      appliance_type: job.appliance_type || '', brand: brand, model_number: job.model_number || '',
      ordered_at: Date.now(), order_status: 'ordered', order_reference: String(orderRef),
      source: 'beat_tech', notes: JSON.stringify({ ship_to: 'customer', ship_address: [shipTo.address1, shipTo.city, shipTo.state, shipTo.zip].filter(Boolean).join(', '), beats_visit: beats }),
    });
  } catch (_) {}
  try { await crud.logEvent('parts_beat_tech_ordered', { ...plan, order_reference: orderRef, at_ms: Date.now() }); } catch (_) {}

  // Miss handling: order was placed anyway — flag the office to move the visit.
  let reschedFlag = false;
  if (beats === false && visitMs) { reschedFlag = true; try { await crud.logEvent('parts_beat_tech_reschedule_flag', { job_id: jobId, part, eta_days: etaDays, scheduled_start: job.scheduled_start, note: 'Part ordered but ETA is after the visit — move the day.', at_ms: Date.now() }); } catch (_) {} }

  return json(200, { ok: true, mode: 'live', ordered: true, order_reference: orderRef, beats_visit: beats, reschedule_flagged: reschedFlag, part, who: shipTo.name });
};
