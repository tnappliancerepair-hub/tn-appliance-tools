// create-vent-booking — Stripe Checkout for a DRYER VENT CLEANING booking. Vent customers
// don't need the appliance-repair intake (no model#, no diagnosis) — they need to tell us
// their setup + concern, pick availability, and put money down to lock the appointment.
// $80 books it (the price of a standard single-story wall vent) and applies to the total;
// roof / two- or three-story runs are more and the tech confirms on-site. Carries the
// intake as metadata; verify-vent-booking creates the job on payment. Mirrors
// create-quickcheck-payment.
//
//   POST { name, phone, email, address, city, state, zip, concern, concern_note,
//          setup, vent_exit, availability }  ->  { ok, url }
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');

const DEPOSIT_CENTS = 8000;            // $80 — books a standard vent in full; deposit on bigger jobs
const TEST_TOKEN = 'tn-vent-test-2026';
const TEST_CENTS = 100;                // $1 for an end-to-end test run
const SITE = 'https://tnapplianceexchange.net';
function s(v, max) { return String(v == null ? '' : v).slice(0, max || 480); }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const phone = s(b.phone, 40);
  if (phone.replace(/\D/g, '').length < 10) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'valid phone required' }) };

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'payments not configured' }) };

  const email = s(b.email, 120);
  const isTest = s(b.vent_test, 40) === TEST_TOKEN;
  const cents = isTest ? TEST_CENTS : DEPOSIT_CENTS;
  const productName = isTest
    ? 'Dryer Vent Cleaning — TEST ($1)'
    : 'Dryer Vent Cleaning — $80: full inspection + up to a 2-foot vent cleaning (applies to your total; longer runs quoted on-site)';

  try {
    const stripe = new Stripe(key);
    const opts = {
      mode: 'payment',
      line_items: [{ price_data: { currency: 'usd', product_data: { name: productName }, unit_amount: cents }, quantity: 1 }],
      success_url: `${SITE}/vent-booking-thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/vent-intake.html`,
      metadata: {
        service: 'vent', kind: 'vent', amount_cents: String(cents), is_test: isTest ? 'yes' : 'no',
        name: s(b.name, 120), phone: phone, email: email,
        address: s(b.address, 200), city: s(b.city, 80), state: s(b.state, 4), zip: s(b.zip, 12),
        concern: s(b.concern, 120), concern_note: s(b.concern_note, 400),
        setup: s(b.setup, 40), vent_exit: s(b.vent_exit, 40),
        availability: s(b.availability, 300),
        sms_consent: 'yes',
        source: 'vent_intake',
      },
    };
    if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) opts.customer_email = email;
    const session = await stripe.checkout.sessions.create(opts);
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, url: session.url }) };
  } catch (e) {
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
