// openai-ads-diag — owner-gated proof-of-plumbing for the OpenAI ChatGPT Ads API.
// Run it the moment Teddy vaults OPENAI_ADS_API_KEY (+ OPENAI_ADS_PIXEL_ID) to
// confirm the key authenticates. Mirrors amazon-business-test / frontdoor-test.
//
//   GET ?secret=<admin>            -> auth check (GET /ad_account) + which vault
//                                     pieces are present. Configured:false until vaulted.
'use strict';
const { getSecret } = require('./_lib/secrets');
const oa = require('./_lib/openai-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const c = await oa.creds();
  const check = await oa.configured();
  return json(200, {
    ok: true, mode: 'diag',
    has_api_key: !!c.key,
    has_conversion_key: !!(c.convKey && c.convKey !== c.key),
    has_pixel_id: !!c.pixelId,
    configured: check.configured, http: check.status || null,
    account: check.account || null,
    error: check.error || null,
    note: check.configured
      ? 'ChatGPT Ads management key is live — ready to launch a test campaign. For the conversion loop, also vault OPENAI_ADS_CONVERSION_KEY + OPENAI_ADS_PIXEL_ID.'
      : 'Vault OPENAI_ADS_API_KEY (management), OPENAI_ADS_CONVERSION_KEY, and OPENAI_ADS_PIXEL_ID via admin-secrets.html, then re-run.',
  });
};
