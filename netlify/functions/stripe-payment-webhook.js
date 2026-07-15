// Backstop for customer payments: catches checkout.session.completed even if
// the customer closes the tab before the success redirect runs verify-payment.
// Verifies Stripe's signature with the signing secret from the VAULT (so it
// doesn't need a Netlify env var — no 4KB fight), then records the paid session
// via the shared recorder (idempotent per session_id, so it never double-counts
// with verify-payment).
//
// Stripe dashboard → Developers → Webhooks → add endpoint:
//   https://tnapplianceexchange.net/.netlify/functions/stripe-payment-webhook
//   event: checkout.session.completed
// Then store its signing secret in the vault as STRIPE_PAYMENT_WEBHOOK_SECRET
// (admin-secrets.html → "Other…" → STRIPE_PAYMENT_WEBHOOK_SECRET → whsec_...).

'use strict';

const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { recordPaidSession } = require('./_lib/record-payment');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const whSecret = await getSecret('STRIPE_PAYMENT_WEBHOOK_SECRET');
  if (!whSecret) {
    console.error('[stripe-payment-webhook] STRIPE_PAYMENT_WEBHOOK_SECRET not in vault');
    return { statusCode: 500, body: JSON.stringify({ error: 'webhook secret not configured' }) };
  }

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  let stripeEvent;
  try {
    stripeEvent = Stripe.webhooks.constructEvent(rawBody, sig, whSecret);
  } catch (err) {
    console.error('[stripe-payment-webhook] signature verification failed:', err.message);
    return { statusCode: 400, body: JSON.stringify({ error: 'bad signature' }) };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ ignored: true, type: stripeEvent.type }) };
  }

  try {
    const session = stripeEvent.data && stripeEvent.data.object;
    // Only record genuinely-paid sessions.
    if (session && session.payment_status === 'paid') {
      const r = await recordPaidSession(session);
      console.log('[stripe-payment-webhook]', session.id, JSON.stringify(r));
      // PM pay-and-save-card links: close the loop even if the payer closed the tab
      // before the redirect (marks the job paid, sets the card default, alerts Teddy).
      if (session.metadata && session.metadata.source === 'pm_invoice_link') {
        try { await fetch('https://tnapplianceexchange.net/.netlify/functions/pm-payment-verify?session_id=' + encodeURIComponent(session.id), { method: 'GET' }); } catch (_) {}
      }
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[stripe-payment-webhook] record failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'record failed' }) };
  }
};
