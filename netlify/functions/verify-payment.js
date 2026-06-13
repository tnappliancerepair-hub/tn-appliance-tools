// Confirms a Stripe Checkout payment after the success redirect, and records
// it — no webhook secret needed (only STRIPE_SECRET_KEY, read from the vault).
// Idempotent per session_id (shared with the webhook backstop) so neither path
// double-records / double-credits.
//
// GET /.netlify/functions/verify-payment?session_id=cs_...
// -> { ok, paid, kind, amount, job_id }

'use strict';

const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { recordPaidSession } = require('./_lib/record-payment');

function jsonResp(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const sessionId = ((event.queryStringParameters || {}).session_id || '').trim();
  if (!sessionId) return jsonResp(400, { ok: false, error: 'session_id required' });

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return jsonResp(200, { ok: false, error: 'stripe_not_configured' });

  try {
    const stripe = new Stripe(key);
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = s && s.payment_status === 'paid';
    const md = (s && s.metadata) || {};
    const amount = (s && s.amount_total != null) ? s.amount_total / 100 : 0;
    const jobId = Number(md.job_id) || 0;
    const kind = md.kind || 'invoice';

    if (!paid) return jsonResp(200, { ok: true, paid: false, kind, amount, job_id: jobId });

    await recordPaidSession(s); // idempotent
    return jsonResp(200, { ok: true, paid: true, kind, amount, job_id: jobId });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message });
  }
};
