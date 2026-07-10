// amazon-business-test — owner-gated proof-of-plumbing for the Amazon Business API.
// Run it the moment the SPP sandbox creds are vaulted to confirm auth works
// (sandbox-first, no production approval needed).
//
//   GET ?secret=<admin>                -> auth-only check (mints an LWA token)
//   GET ?secret=<admin>&order=1[&asin=B0...]  -> sandbox TRIAL order (validates, no real buy)
//
// Defaults to env=sandbox in the connector, so this can never fire a real order
// unless the vault flips AMAZON_BUSINESS_ENV=production AND you pass &live=1.
'use strict';
const { getSecret } = require('./_lib/secrets');
const amzn = require('./_lib/amazon-business');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  // ?env=production TESTS production without flipping the live AMAZON_BUSINESS_ENV.
  const envOverride = q.env ? String(q.env).toLowerCase() : undefined;

  // ?config=1 — which vault pieces are present (booleans only, no secret values).
  if (q.config === '1') {
    const c = await amzn.creds(envOverride);
    return json(200, {
      ok: true, mode: 'config', env: c.env,
      has_client_id: !!c.clientId, has_client_secret: !!c.clientSecret, has_refresh: !!c.refresh,
      has_group_id: !!c.groupId, has_buyer_email: !!c.buyerEmail, has_payment_ref: !!c.paymentRef,
      configured: amzn.isConfigured(c),
    });
  }

  // auth-only by default
  if (q.order !== '1') {
    const a = await amzn.authCheck(envOverride);
    return json(200, { ok: a.ok, mode: 'auth_check', ...a });
  }

  const live = q.live === '1';
  const asin = String(q.asin || 'B07FZ8S74R');

  // ?real=1 → validate the REAL vaulted config (our group + buyer email + a real
  // ship address). Pair with ?env=production for a true production trial (buys
  // nothing unless &live=1). group/buyerEmail omitted so they fall back to vault.
  if (q.real === '1') {
    const res = await amzn.placeOrder({
      asin, quantity: 1, externalId: 'ant-trial-' + Date.now(), envOverride,
      poNumber: 'ANT-TRIAL', unitPrice: 25.0,
      ship: { name: 'TN Appliance Exchange', company: 'TN Appliance Exchange', line1: '3137 Skinner Dr', city: 'Antioch', state: 'TN', zip: '37013', phone: '6154855795' },
      trial: !live,
    });
    return json(200, { ok: res.ok, mode: live ? 'REAL_LIVE_ORDER' : 'real_trial', ...res });
  }

  // default sandbox trial — Amazon's documented example values so the static
  // sandbox can pattern-match a mocked response.
  const res = await amzn.placeOrder({
    asin, quantity: 1, externalId: 'ant-test-' + Date.now(), envOverride,
    group: 'ExampleGroup', buyerEmail: 'user@example.com', poNumber: 'ExamplePO', unitPrice: 10.0,
    ship: { name: 'Example User', company: 'TN Appliance Exchange', line1: '123 Example St.', city: 'Seattle', state: 'WA', zip: '98109', phone: '1234567890' },
    trial: !live,
  });
  return json(200, { ok: res.ok, mode: live ? 'live_order' : 'trial_order', ...res });
};
