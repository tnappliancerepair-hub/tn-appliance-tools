// meta-ads-diag — owner-gated smoke test for the Meta (FB/IG) Marketing API.
// Proves the ads token + ad account resolve. Returns configured:false cleanly
// (with what's missing) until META_AD_ACCOUNT_ID + META_ADS_TOKEN are vaulted.
//
//   GET ?secret=<VAPI_ADMIN_SECRET>
'use strict';
const { getSecret } = require('./_lib/secrets');
const meta = require('./_lib/meta-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const res = await meta.configured();
  return json(200, Object.assign({ ok: !!res.ok }, res, {
    hint: res.configured ? 'ready — meta-ads-create-campaign can apply' : 'vault META_AD_ACCOUNT_ID + META_ADS_TOKEN (ads_management) via admin-secrets.html',
  }));
};
