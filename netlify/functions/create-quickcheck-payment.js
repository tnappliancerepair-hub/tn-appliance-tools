// create-quickcheck-payment — creates the $50 Quick Check Stripe Checkout session
// for the appliance-AI flow. Carries the captured intake (name/phone/address/
// appliance/brand/problem/town/sms-consent) as metadata so, on payment, the
// verify step can create the cash job + fire the 💵 siren. No job exists yet —
// the $50 is what kicks the whole thing off (pay-to-start).
//
//   POST { name, phone, address, city, zip, appliance, brand, problem, payer, sms_consent, town }
//   -> { ok, url }   (redirect the browser to url)

'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');

const PRICE_CENTS = 5000; // LIVE $50 Quick Check (was $1 during testing). ?qc=<token> still charges $1 for test runs.
// Test override: a link carrying ?qc=<this token> charges $1 so we can run the
// full flow end-to-end without flipping the live price (real customers stay $50).
const QC_TEST_TOKEN = 'tn-qc-test-2026';
const TEST_PRICE_CENTS = 100; // $1
const SITE = 'https://tnapplianceexchange.net';

function s(v, max) { return String(v == null ? '' : v).slice(0, max || 480); }

// Allow the call from any TN Appliance host (www or non-www) so a www page load
// doesn't get "Load failed" on the cross-origin POST.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const phone = s(b.phone, 40);
  if (phone.replace(/\D/g, '').length < 10) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'valid phone required' }) };

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'payments not configured' }) };

  const email = s(b.email, 120);
  const machine = [s(b.brand, 40), s(b.appliance, 40)].filter(Boolean).join(' ') || 'appliance';
  const isTest = s(b.qc_test, 40) === QC_TEST_TOKEN;
  // service: 'in_home' = $100 tech-comes-out (pay before we schedule), else $50 phone
  // Quick Check. Test token makes either $1. (Teddy 2026-06-27.)
  const service = s(b.service, 20) === 'in_home' ? 'in_home' : 'quick_check';
  const baseCents = service === 'in_home' ? 10000 : PRICE_CENTS;
  const priceCents = isTest ? TEST_PRICE_CENTS : baseCents;
  const productName = isTest
    ? (service === 'in_home' ? 'In-Home Diagnostic — TEST ($1)' : 'Appliance Quick Check — TEST ($1)')
    : (service === 'in_home'
        ? 'In-Home Diagnostic — tech comes to you ($100, credited to your repair)'
        : 'Appliance Quick Check — honest diagnosis ($50, credited to your repair)');
  try {
    const stripe = new Stripe(key);
    const opts = {
      mode: 'payment',
      line_items: [{
        price_data: { currency: 'usd', product_data: { name: productName }, unit_amount: priceCents },
        quantity: 1,
      }],
      success_url: `${SITE}/quick-check-thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/appliance-ai.html`,
      metadata: {
        kind: service,
        service: service,
        amount_cents: String(priceCents),
        is_test: isTest ? 'yes' : 'no',
        name: s(b.name, 120), phone: phone, email: email,
        address: s(b.address, 200), city: s(b.city, 80), zip: s(b.zip, 12),
        appliance: s(b.appliance, 60), brand: s(b.brand, 60), machine: s(machine, 80),
        problem: s(b.problem, 400),
        payer: s(b.payer, 20) || 'cash',
        sms_consent: b.sms_consent ? 'yes' : 'no',
        availability: s(b.availability, 300),
        language: s(b.language, 8) || 'en',
        town: s(b.town, 80),
        hose_item: s(b.hose_item, 60),
        hose_choice: s(b.hose_choice, 8),
        conv_id: s(b.conv_id, 40),
        has_video: b.has_video ? 'yes' : 'no',
        has_model: b.has_model ? 'yes' : 'no',
        source: 'appliance_ai_quick_check',
      },
    };
    // pre-fill the Stripe email field so the customer doesn't have to type it (the
    // exact friction that stalled the first test). Falls back to Stripe asking if blank.
    if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) opts.customer_email = email;
    const session = await stripe.checkout.sessions.create(opts);
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, url: session.url }) };
  } catch (e) {
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
