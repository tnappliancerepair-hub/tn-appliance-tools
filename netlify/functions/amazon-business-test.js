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

  // auth-only by default
  if (q.order !== '1') {
    const a = await amzn.authCheck();
    return json(200, { ok: a.ok, mode: 'auth_check', ...a });
  }

  // sandbox trial order (validates the full ordering payload without buying)
  const live = q.live === '1';
  const asin = String(q.asin || 'B07FZ8S74R'); // generic sandbox test ASIN
  const res = await amzn.placeOrder({
    asin, quantity: 1, externalId: 'ant-test-' + Date.now(),
    ship: { name: 'Test Customer', line1: '5403 Mount View Rd', city: 'Antioch', state: 'TN', zip: '37013', phone: '6152802949' },
    trial: !live, // trial unless explicitly &live=1
  });
  return json(200, { ok: res.ok, mode: live ? 'live_order' : 'trial_order', ...res });
};
