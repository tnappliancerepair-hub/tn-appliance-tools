// openai-ads-upload-conversion — upload ONE conversion to the OpenAI ChatGPT Ads
// Conversions API: "this person booked / paid a $X job." This is what teaches the
// system we CONVERT, so we earn better placement for less spend (ranking is bid ×
// relevance × trust × conversion-likelihood — this feeds the last term).
//
// Matches the person by HASHED phone/email we already store on every job — no new
// site tracking needed for v1. (The pixel __obref cookie is a later accuracy add.)
//
//   GET ?secret=<admin>&type=appointment_scheduled|order_created&phone=&email=&value=&validate=1
//        manual test; &validate=1 = validate_only (nothing recorded)
//   (also called internally by openai-ads-conversion-sweep)
'use strict';
const crypto = require('crypto');
const { getSecret } = require('./_lib/secrets');
const oa = require('./_lib/openai-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// UTF-8 → SHA-256 → lowercase 64-hex. Empty in → empty out (so we never hash "").
function sha256(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v) return '';
  return crypto.createHash('sha256').update(v, 'utf8').digest('hex');
}
// E.164 digits-only (US-friendly): strip non-digits, add country code if a bare
// 10-digit US number, then hash. Industry-standard normalization before hashing.
function hashPhone(p) {
  let d = String(p == null ? '' : p).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) d = '1' + d;
  return sha256(d);
}
// Email: lowercase + trim, then hash.
function hashEmail(e) {
  const v = String(e == null ? '' : e).trim().toLowerCase();
  if (!v || v.indexOf('@') < 0) return '';
  return sha256(v);
}

const EVENT_TYPES = new Set(['appointment_scheduled', 'lead_created', 'order_created', 'custom']);

// shared so the sweep can call this directly
async function uploadOpenAiConversion({ event_type, value, phone, email, when_ms, source_url, event_id, validate_only }) {
  const c = await oa.creds();
  if (!c.key) return { ok: false, error: 'not_configured' };
  if (!c.pixelId) return { ok: false, error: 'pixel not set — vault OPENAI_ADS_PIXEL_ID' };

  const type = EVENT_TYPES.has(String(event_type)) ? String(event_type) : 'appointment_scheduled';
  const phone_hash = hashPhone(phone);
  const email_hash = hashEmail(email);
  if (!phone_hash && !email_hash) return { ok: false, error: 'no matchable identifier (phone/email)' };

  const user = {};
  if (email_hash) user.emails_sha256 = [email_hash];
  if (phone_hash) user.phone_numbers_sha256 = [phone_hash];

  const ev = {
    id: String(event_id || (type + '-' + (when_ms || Date.now()))),
    type,
    timestamp_ms: Number(when_ms) || Date.now(),
    // OpenAI action_source enum: web | mobile_app | offline | physical_store | phone_call | email | other
    action_source: 'web',
    user,
  };
  if (source_url) ev.source_url = String(source_url);
  const v = Number(value) || 0;
  // amount must be an integer in ISO-4217 MINOR units (cents); the sweep passes dollars.
  const cents = v > 0 ? Math.round(v * 100) : null;
  // data.type is the event's taxonomy CATEGORY, not the event name:
  //   order_created         -> "contents"        (revenue: amount/currency + a contents[] line)
  //   appointment_scheduled -> "customer_action" (a booking; amount optional/null)
  if (type === 'order_created') {
    ev.data = { type: 'contents', amount: cents, currency: cents != null ? 'USD' : null };
    if (cents != null) ev.data.contents = [{ id: 'appliance-repair', name: 'Appliance repair', quantity: 1, amount: cents, currency: 'USD' }];
  } else {
    // booked / lead — a customer action, no revenue attributed
    ev.data = { type: 'customer_action', amount: null, currency: null };
  }

  const url = `${oa.CONV_BASE}/events?pid=${encodeURIComponent(c.pixelId)}`;
  const body = JSON.stringify({ validate_only: !!validate_only, events: [ev] });
  let r, d;
  // Conversions API (bzr.openai.com) authorizes with the SEPARATE conversion key, not the
  // management key. c.convKey falls back to c.key when only one is vaulted.
  try { r = await fetch(url, { method: 'POST', headers: oa.apiHeaders(c.convKey), body, signal: AbortSignal.timeout(12000) }); d = await r.json().catch(() => ({})); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  return {
    ok: r.ok, http: r.status, event_type: type, value: v, validate_only: !!validate_only,
    matched_on: [email_hash ? 'email' : null, phone_hash ? 'phone' : null].filter(Boolean),
    raw_error: r.ok ? null : ((d && d.error && (d.error.message || d.error)) || d),
    // full response body on failure — surfaces OpenAI's field-level "errors[]" detail so the
    // event payload can be tuned to the schema (see the "See errors for details" message).
    raw_response: r.ok ? undefined : d,
    sent_event: r.ok ? undefined : ev,
    response: r.ok ? d : undefined,
  };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const res = await uploadOpenAiConversion({
    event_type: q.type || 'appointment_scheduled',
    value: q.value, phone: q.phone, email: q.email,
    when_ms: q.when_ms || Date.now(), source_url: q.source_url,
    validate_only: q.validate === '1' || q.validate_only === '1',
  });
  return json(200, res);
};

exports.uploadOpenAiConversion = uploadOpenAiConversion;
exports.hashPhone = hashPhone;
exports.hashEmail = hashEmail;
