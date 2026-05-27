// Stripe webhook for tenant subscription events. Verifies signature +
// forwards verified event to Xano for company.tenant_status updates.
//
// Events handled:
//   - checkout.session.completed → flip company to tenant_status='active'
//   - invoice.payment_succeeded → record + extend
//   - invoice.payment_failed → flip to 'past_due' + alert
//   - customer.subscription.deleted → flip to 'canceled'

const Stripe = require('stripe');

const XANO_RECORD = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/record_subscription_event';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const webhookSecret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;

  if (!webhookSecret || !sig) {
    return { statusCode: 400, body: 'missing signature or webhook secret' };
  }

  let evt;
  try {
    evt = Stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    return { statusCode: 400, body: 'invalid signature: ' + err.message };
  }

  // Forward to Xano
  try {
    await fetch(XANO_RECORD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: evt.id,
        event_type: evt.type,
        company_id: evt.data?.object?.metadata?.company_id || null,
        customer_id_stripe: evt.data?.object?.customer || null,
        subscription_id: evt.data?.object?.subscription || evt.data?.object?.id || null,
        amount_total: evt.data?.object?.amount_total || 0,
        status: evt.data?.object?.status || '',
        raw_preview: JSON.stringify(evt).slice(0, 2000),
      }),
    });
  } catch (err) {
    console.warn('[stripe-subscription-webhook] xano forward failed', err.message);
    return { statusCode: 500, body: 'xano forward failed' };
  }

  return { statusCode: 200, body: 'ok' };
};
