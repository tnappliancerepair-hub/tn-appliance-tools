// Stripe webhook receiver for the cash TDR pay flow (Phase 1c step 3d.3
// 2026-05-06). Verifies Stripe's HMAC-SHA256 signature, filters to
// checkout.session.completed events only, forwards the verified payload
// to Xano with a shared-secret body field for downstream processing.
//
// Architecture:
//   Stripe → this function (verify Stripe-Signature) → Xano
//     /stripe_checkout_session_completed (auth via shared secret) →
//   200 back to Netlify → 200 back to Stripe.
//
// Two-hop because XanoScript can't natively verify Stripe's signature scheme
// (requires raw body bytes before JSON parse). Mirrors hcp-webhook-proxy.js
// architecture.
//
// Retry semantics:
//   - signature verification fails: 400 to Stripe (Stripe won't retry — bad
//     signature is a permanent failure).
//   - non-target event types: 200 ack with ignored: true (Stripe won't retry
//     because we successfully received it; we just chose not to act).
//   - Xano returns 200 with ok:false (e.g., tdr_not_found, duplicate,
//     unauthorized): pass through 200. Stripe won't retry. Right behavior
//     because retrying the same event won't change Xano's data state.
//   - Xano returns 5xx (genuine server error): pass through 5xx. Stripe will
//     retry per its exponential backoff. Self-healing for transient outages.
//   - Network failure reaching Xano: 500 to Stripe. Retries.

// Use Stripe SDK's static webhooks.constructEvent — does NOT require API key
// initialization (we only verify signatures here, never call Stripe API).
// Avoids module-load crash when STRIPE_SECRET_KEY is unset in this context.
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');

const XANO_URL = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:VGkW9mcV/stripe_checkout_session_completed';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Vault-first (then env): the 4KB Netlify env cap forced these out of the
  // Functions runtime on 2026-06-13, which 500'd this webhook. Reading from the
  // vault sidesteps the cap permanently — works whether the value is in the vault
  // OR re-scoped to env.
  const webhookSecret = await getSecret('STRIPE_WEBHOOK_SECRET');
  const sharedSecret = await getSecret('XANO_WEBHOOK_SHARED_SECRET');
  if (!webhookSecret || !sharedSecret) {
    console.error('[stripe-webhook] secrets not configured (vault or env)');
    return { statusCode: 500, body: JSON.stringify({ error: 'server misconfigured' }) };
  }

  const sigHeader =
    event.headers['stripe-signature'] ||
    event.headers['Stripe-Signature'] ||
    '';

  // Stripe's constructEvent requires raw body bytes (NOT parsed JSON).
  // Netlify provides event.body as utf8 string by default; if the runtime
  // ever sends base64 (unusual for JSON POSTs), decode first.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  let stripeEvent;
  try {
    stripeEvent = Stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Webhook signature verification failed' }),
    };
  }

  // Only process checkout.session.completed. Other event types ack with 200
  // so Stripe doesn't keep retrying — we received them, we just don't act.
  if (stripeEvent.type !== 'checkout.session.completed') {
    console.log('[stripe-webhook] ignoring event type:', stripeEvent.type, 'event_id:', stripeEvent.id);
    return {
      statusCode: 200,
      body: JSON.stringify({ ignored: true, type: stripeEvent.type }),
    };
  }

  // Forward to Xano with shared secret in body field (XanoScript can't
  // reliably read arbitrary HTTP headers, see xano_script_parser_gotchas.md
  // and hcp-webhook-setup.md). Header is also sent for forward-compat.
  const xanoBody = JSON.stringify({
    ...stripeEvent,
    _webhook_secret: sharedSecret,
  });

  let xanoResp;
  try {
    xanoResp = await fetch(XANO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Shared-Secret': sharedSecret,
      },
      body: xanoBody,
    });
  } catch (err) {
    console.error('[stripe-webhook] forward to Xano failed:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'upstream unavailable' }),
    };
  }

  let respText = '';
  try {
    respText = await xanoResp.text();
  } catch (_e) {
    respText = '';
  }

  console.log(
    '[stripe-webhook] forwarded event_id=' + stripeEvent.id,
    'session_id=' + (stripeEvent.data && stripeEvent.data.object && stripeEvent.data.object.id),
    'xano_status=' + xanoResp.status,
    'xano_body_preview=' + respText.slice(0, 200)
  );

  // Pass through Xano's status. Xano returns 200 for both happy-path and
  // intentional-error-don't-retry cases (auth fail, tdr_not_found, duplicate),
  // and 5xx for genuine server errors that warrant a retry.
  return {
    statusCode: xanoResp.status,
    headers: { 'Content-Type': 'application/json' },
    body: respText,
  };
};
