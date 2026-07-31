// sp-api-test — owner-gated diagnostic. Answers "do we really have the Amazon
// SELLER API (SP-API) wired?" It (1) scans the vault for every candidate Amazon
// credential name (values MASKED — never printed), (2) if an SP-API trio is found,
// mints an LWA token and calls the canonical /sellers/v1/marketplaceParticipations
// to prove real seller access + show which marketplace/seller we're connected to.
//   GET ?secret=<admin>
'use strict';
const { getSecretFresh: getSecret } = require('./_lib/secrets');
const spapi = require('./_lib/spapi');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function mask(v) { return v ? (String(v).slice(0, 4) + '…(' + String(v).length + ')') : false; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const candidates = [
    'SPAPI_CLIENT_ID', 'SPAPI_CLIENT_SECRET', 'SPAPI_REFRESH_TOKEN',
    'AMAZON_SPAPI_CLIENT_ID', 'AMAZON_SPAPI_CLIENT_SECRET', 'AMAZON_SPAPI_REFRESH_TOKEN',
    'AMAZON_SP_API_CLIENT_ID', 'AMAZON_SP_API_CLIENT_SECRET', 'AMAZON_SP_API_REFRESH_TOKEN',
    'AMAZON_SELLER_CLIENT_ID', 'AMAZON_SELLER_CLIENT_SECRET', 'AMAZON_SELLER_REFRESH_TOKEN',
    'AMAZON_SP_CLIENT_ID', 'AMAZON_SP_CLIENT_SECRET', 'AMAZON_SP_REFRESH_TOKEN',
    'AMAZON_LWA_CLIENT_ID', 'AMAZON_LWA_CLIENT_SECRET', 'AMAZON_LWA_REFRESH_TOKEN',
    'AMAZON_SELLER_ID', 'AMAZON_MARKETPLACE_ID', 'AMAZON_SPAPI_REGION',
  ];
  const vault_presence = {};
  for (const n of candidates) { try { vault_presence[n] = mask(await getSecret(n)); } catch (_) { vault_presence[n] = 'err'; } }

  const c = await spapi.resolveCreds();
  if (!c) return json(200, { ok: false, has_seller_creds: false, note: 'No SP-API credential trio found in the vault under standard names. Where were the seller creds set up?', vault_presence });

  try {
    const token = await spapi.accessToken(c);
    const mp = await spapi.apiGet('/sellers/v1/marketplaceParticipations', c, token);
    return json(200, {
      ok: true, has_seller_creds: true, used_credential_names: c.usedNames, region: c.region,
      token_acquired: !!token,
      seller_verified: mp.ok, marketplaceParticipations_status: mp.status,
      marketplaces: mp.ok ? (mp.data.payload || mp.data) : mp.data,
      vault_presence,
    });
  } catch (e) {
    return json(200, { ok: false, has_seller_creds: true, token_error: String((e && e.message) || e).slice(0, 240), used_credential_names: c.usedNames, vault_presence });
  }
};
