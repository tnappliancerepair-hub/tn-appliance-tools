// google-ads-test — owner-gated proof that the Google Ads API is wired: mints an
// access token from the vaulted refresh token + dev token + MCC, and lists the
// Ads accounts Ant can reach. Run after the OAuth callback saves the refresh token.
//   GET ?secret=<admin>
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  try {
    const res = await ads.listAccessibleCustomers();
    return json(200, res);
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
