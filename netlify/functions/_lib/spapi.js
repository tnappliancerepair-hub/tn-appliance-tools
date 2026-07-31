// Amazon Selling Partner API (SP-API) client — the SELLER side (list products,
// prices, inventory, orders = the storefront automation). LWA-only auth (Amazon
// dropped the AWS SigV4/IAM requirement in 2024) — a refresh token authorized
// against our Seller Central account -> access token -> x-amz-access-token header.
//
// Creds live in the runtime vault. Teddy may have vaulted the seller app under any
// of several standard names, so resolveCreds() tries a prioritized list and reports
// which trio it used. Set the canonical names via admin-secrets.html once known:
//   SPAPI_CLIENT_ID, SPAPI_CLIENT_SECRET, SPAPI_REFRESH_TOKEN
//   (optional) AMAZON_SELLER_ID, AMAZON_MARKETPLACE_ID, AMAZON_SPAPI_REGION (na|eu|fe)
'use strict';
const { getSecretFresh: getSecret } = require('./secrets');

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const ENDPOINTS = { na: 'https://sellingpartnerapi-na.amazon.com', eu: 'https://sellingpartnerapi-eu.amazon.com', fe: 'https://sellingpartnerapi-fe.amazon.com' };
const US_MARKETPLACE_ID = 'ATVPDKIKX0DER';

// candidate vault name trios — first fully-present set wins.
const NAME_SETS = [
  { client: 'SPAPI_CLIENT_ID', secret: 'SPAPI_CLIENT_SECRET', refresh: 'SPAPI_REFRESH_TOKEN' },
  { client: 'AMAZON_SPAPI_CLIENT_ID', secret: 'AMAZON_SPAPI_CLIENT_SECRET', refresh: 'AMAZON_SPAPI_REFRESH_TOKEN' },
  { client: 'AMAZON_SP_API_CLIENT_ID', secret: 'AMAZON_SP_API_CLIENT_SECRET', refresh: 'AMAZON_SP_API_REFRESH_TOKEN' },
  { client: 'AMAZON_SELLER_CLIENT_ID', secret: 'AMAZON_SELLER_CLIENT_SECRET', refresh: 'AMAZON_SELLER_REFRESH_TOKEN' },
  { client: 'AMAZON_SP_CLIENT_ID', secret: 'AMAZON_SP_CLIENT_SECRET', refresh: 'AMAZON_SP_REFRESH_TOKEN' },
  // same LWA app as the buyer, but a seller-scoped refresh token vaulted separately:
  { client: 'AMAZON_LWA_CLIENT_ID', secret: 'AMAZON_LWA_CLIENT_SECRET', refresh: 'AMAZON_SPAPI_REFRESH_TOKEN' },
  { client: 'AMAZON_LWA_CLIENT_ID', secret: 'AMAZON_LWA_CLIENT_SECRET', refresh: 'AMAZON_SELLER_REFRESH_TOKEN' },
];

async function resolveCreds() {
  for (const s of NAME_SETS) {
    const [client, secret, refresh] = await Promise.all([getSecret(s.client), getSecret(s.secret), getSecret(s.refresh)]);
    if (client && secret && refresh) {
      const [sellerId, marketplaceId, region] = await Promise.all([
        getSecret('AMAZON_SELLER_ID'), getSecret('AMAZON_MARKETPLACE_ID'), getSecret('AMAZON_SPAPI_REGION'),
      ]);
      return { client, secret, refresh, sellerId: sellerId || null, marketplaceId: marketplaceId || US_MARKETPLACE_ID, region: String(region || 'na').toLowerCase(), usedNames: s };
    }
  }
  return null;
}

async function accessToken(c) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.client, client_secret: c.secret });
  const r = await fetch(LWA_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('lwa token: ' + JSON.stringify(d).slice(0, 220));
  return d.access_token;
}

async function apiGet(path, c, token) {
  const base = ENDPOINTS[c.region] || ENDPOINTS.na;
  const r = await fetch(base + path, { headers: { 'x-amz-access-token': token, 'content-type': 'application/json' } });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, data: d };
}

module.exports = { resolveCreds, accessToken, apiGet, ENDPOINTS, US_MARKETPLACE_ID, NAME_SETS, LWA_TOKEN_URL };
