// oem-request — captures an OEM-part order request from applianceant.com's
// order-oem page into a durable worklist, so the office can quote it, send a
// Stripe pay link, and drop-ship it from Marcone (quote-then-pay). Replaces the
// fire-and-forget Netlify Form: this stores an `oem_part_request` event_log row
// (queryable by oem-orders.html) and texts the office that a request came in.
//
// Called CROSS-ORIGIN from applianceant.com (a separate Netlify site) -> CORS open.
// Captures a request only; it charges nothing and orders nothing.
//
//   POST { part, appliance, brand, model, name, phone, email, address, city,
//          state_zip, notes, source_page }  -> { ok, request_id }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');

const OWNER = '+16154855795';    // Teddy
const DANIELLE = '+16154850713'; // office

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}
const s = (v) => String(v == null ? '' : v).trim().slice(0, 400);

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }

  const req = {
    part: s(b.part), appliance: s(b.appliance), brand: s(b.brand), model: s(b.model),
    name: s(b.name), phone: s(b.phone).replace(/[^\d+]/g, ''), email: s(b.email),
    address: s(b.address), city: s(b.city), state_zip: s(b.state_zip),
    notes: s(b.notes), source_page: s(b.source_page),
  };
  // Minimum to act on it: something to source + a way to reach them.
  if (!req.part && !req.appliance) return j(400, { ok: false, error: 'part or appliance required' });
  if (!req.phone && !req.email) return j(400, { ok: false, error: 'phone or email required' });

  const requestId = 'oem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  try {
    await crud.logEvent('oem_part_request', Object.assign({ request_id: requestId, status: 'requested', at_ms: Date.now() }, req));
  } catch (e) {
    return j(200, { ok: false, error: 'could_not_save', detail: String((e && e.message) || e) });
  }

  // Nudge the office that a request landed (best-effort, never blocks the response).
  const line = '🔧 NEW PART REQUEST · ' + (req.part || req.appliance) + (req.brand ? ' (' + req.brand + (req.model ? ' ' + req.model : '') + ')' : '')
    + (req.name ? ' · ' + req.name : '') + ' — quote + send pay link: tnapplianceexchange.net/oem-orders.html';
  try { await sendSms(OWNER, line, 'owner', 'oem_request'); } catch (_) {}
  try { await sendSms(DANIELLE, line, 'office', 'oem_request'); } catch (_) {}

  return j(200, { ok: true, request_id: requestId });
};
