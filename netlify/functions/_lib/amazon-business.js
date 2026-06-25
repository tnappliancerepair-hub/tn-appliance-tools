// Amazon Business Ordering API client — programmatic placeOrder (ship to the
// customer). Auth = Login with Amazon (LWA) refresh token -> access token.
// All credentials come from the runtime vault; if any are missing the caller
// gets {configured:false} and falls back to the manual/one-tap path.
//
// Docs: https://docs.business.amazon.com/docs/placing-an-order
//   prod:    POST https://na.business-api.amazon.com/ordering/2022-10-30/orders
//   sandbox: POST https://sandbox.na.business-api.amazon.com/ordering/2022-10-30/orders
//
// SANDBOX-FIRST (like Frontdoor): you can hit the sandbox the moment your SPP
// account + sandbox app exist — no production approval needed. Default env is
// "sandbox" so we never accidentally fire a real order during testing; flip the
// vault AMAZON_BUSINESS_ENV=production when the prod approval email lands.
//
// Vault keys (set via admin-secrets.html):
//   AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_LWA_REFRESH_TOKEN  (SPP sandbox app)
//   AMAZON_BUSINESS_ENV           ("sandbox" | "production"; default "sandbox")
//   AMAZON_BUSINESS_GROUP_ID      (BuyingGroupReference - GroupIdentity)
//   AMAZON_BUSINESS_BUYER_EMAIL   (BuyerReference - UserEmail)
//   AMAZON_BUSINESS_PAYMENT_REF   (StoredPaymentMethod reference id)
//   AMAZON_BUSINESS_REGION        (default "US")

'use strict';
const { getSecret } = require('./secrets');

const ORDER_PATH = '/ordering/2022-10-30/orders';
const BASE = { sandbox: 'https://sandbox.na.business-api.amazon.com', production: 'https://na.business-api.amazon.com' };
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

function baseFor(env) { return BASE[String(env || 'sandbox').toLowerCase()] || BASE.sandbox; }

async function creds() {
  const [clientId, clientSecret, refresh, groupId, buyerEmail, paymentRef, region, env] = await Promise.all([
    getSecret('AMAZON_LWA_CLIENT_ID'), getSecret('AMAZON_LWA_CLIENT_SECRET'), getSecret('AMAZON_LWA_REFRESH_TOKEN'),
    getSecret('AMAZON_BUSINESS_GROUP_ID'), getSecret('AMAZON_BUSINESS_BUYER_EMAIL'), getSecret('AMAZON_BUSINESS_PAYMENT_REF'),
    getSecret('AMAZON_BUSINESS_REGION'), getSecret('AMAZON_BUSINESS_ENV'),
  ]);
  const e = String(env || 'sandbox').toLowerCase();
  return { clientId, clientSecret, refresh, groupId, buyerEmail, paymentRef, region: region || 'US', env: e, orderUrl: baseFor(e) + ORDER_PATH };
}

function isConfigured(c) { return !!(c.clientId && c.clientSecret && c.refresh && c.groupId && c.buyerEmail && c.paymentRef); }

async function accessToken(c) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.clientId, client_secret: c.clientSecret });
  const r = await fetch(LWA_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('lwa token: ' + JSON.stringify(d).slice(0, 200));
  return d.access_token;
}

// place (or trial) an order for one ASIN shipped to a customer address.
//   opts: { asin, quantity, ship:{name,line1,line2,city,state,zip,phone}, externalId,
//           offerId?, poNumber?, trial=true }
// trial=true uses TrialMode (validates without creating a real order) — default-safe.
async function placeOrder(opts) {
  const c = await creds();
  if (!isConfigured(c)) return { ok: false, configured: false, reason: 'amazon_business_not_configured' };
  const token = await accessToken(c);
  const ship = opts.ship || {};
  const payload = {
    externalId: String(opts.externalId || ('ant-' + Date.now())).slice(0, 60),
    lineItems: [{
      lineItemId: '1',
      quantity: opts.quantity || 1,
      attributes: [
        { SelectedProductReference: { productReferenceType: 'ProductIdentifier', identifier: String(opts.asin), identifierType: 'ASIN' } },
      ].concat(opts.offerId ? [{ SelectedBuyingOptionReference: { offerId: String(opts.offerId) } }] : []),
    }],
    attributes: [
      { Region: c.region },
      { SelectedPaymentMethodReference: { paymentMethodReferenceType: 'StoredPaymentMethod', identifier: c.paymentRef } },
      { BuyingGroupReference: { groupReferenceType: 'GroupIdentity', identifier: c.groupId } },
      { BuyerReference: { userReferenceType: 'UserEmail', identifier: c.buyerEmail } },
      { ShippingAddress: { addressType: 'PhysicalAddress', name: ship.name || 'Customer', addressLine1: ship.line1 || '', addressLine2: ship.line2 || '', city: ship.city || '', stateOrRegion: ship.state || '', postalCode: ship.zip || '', countryCode: 'US', phoneNumber: ship.phone || '' } },
      { PurchaseOrderNumber: String(opts.poNumber || opts.externalId || 'ANT').slice(0, 30) },
    ],
    ...(opts.trial === false ? {} : { attributes_TrialMode: true }),
  };
  // TrialMode is an order attribute; include it explicitly when validating
  if (opts.trial !== false) payload.attributes.push({ TrialMode: true });

  const r = await fetch(c.orderUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-amz-access-token': token },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, env: c.env, trial: opts.trial !== false, response: d };
}

// auth-only smoke test: proves the SPP sandbox creds mint an LWA access token,
// before group/buyer/payment refs are even set. Returns {ok, env, token_acquired}.
async function authCheck() {
  const c = await creds();
  if (!c.clientId || !c.clientSecret || !c.refresh) {
    return { ok: false, configured: false, env: c.env, missing: ['client_id', 'client_secret', 'refresh_token'].filter((k) => !c[{ client_id: 'clientId', client_secret: 'clientSecret', refresh_token: 'refresh' }[k]]) };
  }
  try {
    const token = await accessToken(c);
    return { ok: true, env: c.env, base: baseFor(c.env), token_acquired: !!token, token_preview: token ? (token.slice(0, 12) + '…') : null };
  } catch (e) {
    return { ok: false, env: c.env, error: String((e && e.message) || e).slice(0, 240) };
  }
}

module.exports = { placeOrder, creds, isConfigured, authCheck, baseFor };
