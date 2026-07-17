// vent-plan — "Vent Care Plan" signup: a homeowner (or property) opting into an ANNUAL
// dryer vent cleaning membership. Recurring, differentiated (no competitor in either market
// offers a plan), and it plugs into the PM/apartment funnel. Captures the signup, logs it
// as `vent_plan_signup` (which the annual-reminder cron reads), and texts Teddy + Danielle
// so a real person locks in the member's rate + first cleaning. Mirrors pm-inquiry.
//
// POST { name, phone, email, address, city, state, zip, plan_type, message }
'use strict';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const { sendSms } = require('./_lib/sms');
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
async function logRow(action, metadata) {
  const h = headers(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action, metadata }) }); } catch (_) {}
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n);

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const name = s(b.name, 80);
  const phone = s(b.phone, 40);
  const email = s(b.email, 120);
  const address = s(b.address, 160);
  const city = s(b.city, 60);
  const state = s(b.state, 4);
  const zip = s(b.zip, 12);
  const planType = s(b.plan_type || 'home', 40);   // home | property | multi-family
  const message = s(b.message, 500);

  if (!name && !phone) return jsonResp(400, { ok: false, error: 'name + phone required' });
  if (!phone) return jsonResp(400, { ok: false, error: 'phone required' });

  await logRow('vent_plan_signup', { name, phone, email, address, city, state, zip, plan_type: planType, message, at_ms: Date.now() });

  const isProp = /propert|multi|apartment|complex|portfolio/i.test(planType);
  const label = isProp ? '🔁🏢 VENT CARE PLAN (property)' : '🔁 VENT CARE PLAN (home)';
  const where = [city, state].filter(Boolean).join(', ');
  const alert = '[ant] ' + label + ' signup: ' + (name || '(no name)') + ' ' + phone +
    (where ? (' · ' + where) : '') + (email ? (' · ' + email) : '') +
    (message ? ('\n"' + message.slice(0, 160) + '"') : '') +
    '\nRecurring annual-vent member — lock in their rate + book the first cleaning.';
  try { await sendSms(OWNER, alert, 'owner', 'vent_plan_signup'); } catch (_) {}
  try { await sendSms(DANIELLE, alert, 'warranty_handler', 'vent_plan_signup'); } catch (_) {}

  // Confirm to the member instantly (intake-gate allowlisted tag so it delivers).
  if (phone.replace(/\D/g, '').length >= 10) {
    const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
    const confirm = 'Hi ' + firstName + ", you're on the TN Appliance Exchange Vent Care Plan list 🔁 — we'll text you shortly to lock in your member rate and book your first cleaning. We keep your vent cleaned every year so you never have to think about it. Call or text 615-280-2949 anytime.";
    try { await sendSms(phone, confirm, 'customer', 'intake_vent_plan'); } catch (_) {}
  }

  return jsonResp(200, { ok: true });
};
