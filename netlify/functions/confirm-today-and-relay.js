// confirm-today-and-relay — Teddy 2026-07-08. Texts a customer to confirm it's OK for the
// tech to come TODAY, and arms a relay so whatever they text back is forwarded straight to
// the tech's phone. Used to fill a tech's day fast (John, South Shore) without the office
// dialing each customer.
//
//   POST { job_id, phone, first_name, customer_name, appliance, city, tech_phone, tech_first, message? }
//     -> { ok, sent, reason, phone }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const phone = String(b.phone || '').trim();
  if (!phone) return json(400, { ok: false, error: 'phone required' });
  const first = String(b.first_name || b.customer_name || 'there').trim().split(/\s+/)[0];
  const appliance = String(b.appliance || 'appliance').trim();
  const techFirst = String(b.tech_first || 'our tech').trim();
  const msg = b.message || `Hi ${first}, this is TN Appliance Exchange 🐜 — we've got your ${appliance} repair on ${techFirst}'s route for TODAY. Is it okay for ${techFirst} to come by today? Reply here with a time that works (morning or afternoon) and we'll lock it in. Reply STOP to opt out.`;

  // 1) Arm the relay: the customer's reply gets forwarded to the tech's phone.
  try {
    await crud.logEvent('tech_reply_relay', {
      phone: phone.replace(/\D/g, ''), tech_phone: String(b.tech_phone || ''), tech_first: techFirst,
      customer_name: String(b.customer_name || first), job_id: Number(b.job_id || 0) || 0,
      appliance, city: String(b.city || ''), active: true, at_ms: Date.now(),
    });
  } catch (_) {}

  // 2) Send the confirmation (guarded: opt-out + quiet-hours enforced).
  let sent = false, reason = '';
  try {
    const r = await fetch(`${SITE}/.netlify/functions/guarded-send-sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: msg, tag: 'confirm_today', kind: 'appointment', allowQuiet: true }),
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json().catch(() => ({}));
    sent = !!(d && d.sent); reason = (d && d.reason) || '';
  } catch (e) { reason = String((e && e.message) || e); }

  try { await crud.logEvent('confirm_today_sent', { job_id: Number(b.job_id || 0) || 0, phone: phone.slice(-4), sent, reason, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: true, sent, reason, phone });
};
