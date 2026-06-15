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

const PRICE_CENTS = 100; // TEST MODE: $1 (restore to 5000 = $50 after testing)
const SITE = 'https://tnapplianceexchange.net';

function s(v, max) { return String(v == null ? '' : v).slice(0, max || 480); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const phone = s(b.phone, 40);
  if (phone.replace(/\D/g, '').length < 10) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'valid phone required' }) };

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'payments not configured' }) };

  const machine = [s(b.brand, 40), s(b.appliance, 40)].filter(Boolean).join(' ') || 'appliance';
  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: { currency: 'usd', product_data: { name: 'Appliance Quick Check — honest diagnosis ($50, credited to your repair)' }, unit_amount: PRICE_CENTS },
        quantity: 1,
      }],
      success_url: `${SITE}/quick-check-thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/appliance-ai.html`,
      metadata: {
        kind: 'quick_check',
        amount_cents: String(PRICE_CENTS),
        name: s(b.name, 120), phone: phone,
        address: s(b.address, 200), city: s(b.city, 80), zip: s(b.zip, 12),
        appliance: s(b.appliance, 60), brand: s(b.brand, 60), machine: s(machine, 80),
        problem: s(b.problem, 400),
        payer: s(b.payer, 20) || 'cash',
        sms_consent: b.sms_consent ? 'yes' : 'no',
        town: s(b.town, 80),
        conv_id: s(b.conv_id, 40),
        has_video: b.has_video ? 'yes' : 'no',
        has_model: b.has_model ? 'yes' : 'no',
        source: 'appliance_ai_quick_check',
      },
    });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, url: session.url }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
