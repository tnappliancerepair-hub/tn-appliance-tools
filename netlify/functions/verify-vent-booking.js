// verify-vent-booking — called by vent-booking-thanks.html after the Stripe redirect.
// Verifies the $80 vent booking cleared, then (idempotently) creates the Dryer Vent
// Cleaning job with the customer's concern + setup + availability, records the payment,
// fires the 💵 siren to Teddy + Danielle, and confirms to the customer. Mirrors
// verify-quickcheck but vent-shaped (no model#/diagnosis/media).
//
//   POST { session_id }  ->  { ok, paid, job_id, first_name }
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';
function rowMeta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function stateFromZip(zip) { const z = String(zip || '').replace(/\D/g, '').slice(0, 5); if (/^7[01]/.test(z)) return 'LA'; if (/^3[78]/.test(z)) return 'TN'; return ''; }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

// readable labels for the tapped options
const CONCERN = { slow: 'Taking 2-3 cycles to dry', fire: 'Worried about fire safety', never: 'Never cleaned / not sure when', smell: 'Musty or burning smell', maint: 'Just keeping up with maintenance', other: 'Other concern' };
const SETUP = { one: 'Single-story', two: 'Two-story', three: 'Three-story' };
const EXIT = { wall: 'Exits a side wall', roof: 'Exits through the roof', unsure: 'Not sure how it vents' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const sessionId = String(b.session_id || '').trim();
  if (!sessionId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'session_id required' }) };

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'payments not configured' }) };
  let session;
  try { session = await new Stripe(key).checkout.sessions.retrieve(sessionId); }
  catch (_) { return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'could not verify payment' }) }; }
  if (!session || session.payment_status !== 'paid') {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, paid: false, payment_status: (session && session.payment_status) || 'none' }) };
  }

  const m = session.metadata || {};
  const amount = Number(m.amount_cents || 8000) / 100;
  const nameParts = String(m.name || '').trim().split(/\s+/);
  const first = nameParts[0] || 'there';

  // idempotent: same session already processed?
  try {
    const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'vent_booking_paid' }, { created_at: 'desc' }, 200);
    const hit = (prior || []).find((r) => rowMeta(r).session_id === sessionId);
    if (hit) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, paid: true, already: true, job_id: rowMeta(hit).job_id, first_name: first }) };
  } catch (_) {}

  // Compose what the office + tech need from the vent intake.
  const concernL = CONCERN[m.concern] || (m.concern || '');
  const setupL = SETUP[m.setup] || (m.setup || '');
  const exitL = EXIT[m.vent_exit] || (m.vent_exit || '');
  const summary = ['🔥 Dryer vent cleaning ($80 booked).',
    concernL ? ('Concern: ' + concernL + '.') : '',
    (m.concern_note ? ('"' + String(m.concern_note).slice(0, 200) + '".') : ''),
    [setupL, exitL].filter(Boolean).join(', ') ? ('Setup: ' + [setupL, exitL].filter(Boolean).join(', ') + '.') : ''].filter(Boolean).join(' ');

  let jobId = null;
  try {
    const r = await fetch(`${XANO}/create_job_from_chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: first, last_name: nameParts.slice(1).join(' '),
        phone: m.phone || '', zip: m.zip || '37013',
        appliance_type: 'Dryer Vent Cleaning', brand: '',
        problem_summary: summary, customer_type: 'self_pay',
        recommended_service: 'vent', channel: 'vent_intake', sms_consent: true,
      }),
    });
    const d = await r.json().catch(() => ({}));
    jobId = (d && (d.id || d.job_id)) || null;
  } catch (_) {}

  if (jobId) {
    const pref = [m.availability ? ('AVAIL: ' + m.availability) : '', concernL ? ('Concern: ' + concernL) : '', [setupL, exitL].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    try { await crud.update(crud.TABLES.jobs, jobId, { service_address: m.address || '', service_city: m.city || '', service_state: m.state || stateFromZip(m.zip), customer_preference_text: pref }); } catch (_) {}
    try { await crud.update(crud.TABLES.jobs, jobId, { payment_status: 'paid', payment_collected: true, stripe_payment_reference: sessionId }); } catch (_) {}
  }

  await crud.logEvent('vent_booking_paid', { session_id: sessionId, job_id: jobId, amount, name: m.name, phone: m.phone, email: m.email || '', city: m.city || '', concern: concernL, setup: setupL, exit: exitL, at_ms: Date.now() });
  try { await crud.logEvent('customer_payment_received', { job_id: jobId, amount, kind: 'vent', session_id: sessionId, source: 'vent_intake', at_ms: Date.now() }); } catch (_) {}

  // 💵 siren → Teddy + Danielle
  const link = jobId ? `${SITE}/office-board.html?job=${jobId}` : `${SITE}/office-board.html`;
  const siren = '🔥💵 DRYER VENT BOOKED — $' + amount + ' · ' + (m.name || '(customer)') + (m.city ? (' · ' + m.city) : '') +
    ' — ' + (concernL || 'vent cleaning') + (setupL ? (' · ' + setupL + (exitL ? ', ' + exitL : '')) : '') +
    '\nAvail: ' + (m.availability || '(reply pending)') + '\nJob #' + (jobId || '?') + ' → schedule it: ' + link;
  try { await sendSms(OWNER, siren, 'owner', 'vent_intake_paid'); } catch (_) {}
  try { await sendSms(DANIELLE, siren, 'warranty_handler', 'vent_intake_paid'); } catch (_) {}

  // Confirm to the customer (gate-passing tag).
  if (m.phone) {
    const cmsg = 'Hi ' + first + ", TN Appliance Exchange 🐜 — got your $" + amount + ' dryer vent cleaning booking, thank you! ' +
      (m.availability ? "We'll text you to lock in a day from your availability." : "Just reply with the days/times that work and we'll lock it in.") +
      ' Your tech is CSIA-certified and confirms the final price on-site before any extra work. Call/text 615-280-2949 anytime.';
    try { await sendSms(m.phone, cmsg, 'customer', 'vent_intake_availability'); } catch (_) {}
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, paid: true, job_id: jobId, first_name: first, amount }) };
};
