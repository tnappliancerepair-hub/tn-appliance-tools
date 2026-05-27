// Creates a Stripe Checkout Session for a self-pay job. Returns the
// hosted-checkout URL. Called by the colony-loop stripe_payment_link_due
// agent.
//
// ENV REQUIRED:
//   STRIPE_SECRET_KEY  (Live or test sk_ key)
//   STRIPE_SUCCESS_URL (optional; defaults to tnapplianceexchange.net/pay-thanks.html)
//   STRIPE_CANCEL_URL  (optional; defaults to tnapplianceexchange.net/customer-portal.html)
//
// Inputs: { job_id, amount_cents, description, customer_email?, customer_phone? }
//
// Falls back to placeholder mailto:tnappliancerepair@gmail.com link
// when STRIPE_SECRET_KEY is unset (so the agent flow still works in dev).
const Stripe = require('stripe');

const DEFAULT_SUCCESS = 'https://tnapplianceexchange.net/pay-thanks.html?session_id={CHECKOUT_SESSION_ID}';
const DEFAULT_CANCEL = 'https://tnapplianceexchange.net/customer-portal.html';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const jobId = Number(body.job_id || 0);
  const amountCents = Number(body.amount_cents || 0);
  const description = String(body.description || `TN Appliance Exchange Job #${jobId}`);
  const customerEmail = String(body.customer_email || '').trim();

  if (!jobId || amountCents <= 0) {
    return jsonResp(400, { ok: false, error: 'job_id and amount_cents required' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    // Dev fallback — return a mailto so the agent flow can still run
    return jsonResp(200, {
      ok: true,
      placeholder: true,
      url: `mailto:tnappliancerepair@gmail.com?subject=Pay%20for%20job%20${jobId}&body=$${(amountCents/100).toFixed(2)}%20due`,
      note: 'STRIPE_SECRET_KEY not set — returned mailto placeholder',
    });
  }

  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: description },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: process.env.STRIPE_SUCCESS_URL || DEFAULT_SUCCESS,
      cancel_url: process.env.STRIPE_CANCEL_URL || DEFAULT_CANCEL,
      customer_email: customerEmail || undefined,
      metadata: {
        job_id: String(jobId),
        source: 'colony_loop_stripe_payment_link',
      },
    });

    return jsonResp(200, {
      ok: true,
      url: session.url,
      session_id: session.id,
      amount_cents: amountCents,
    });
  } catch (err) {
    console.error('[create-stripe-payment-link] stripe error', err.message);
    return jsonResp(500, { ok: false, error: err.message });
  }
};

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
