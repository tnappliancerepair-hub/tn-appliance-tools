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
// FRESH reads (not cached getSecret): these creds are vaulted interactively and
// must be picked up the moment they're saved — a warm container caching the old
// empty value would falsely report {configured:false} right after you vault them.
const { getSecretFresh: getSecret } = require('./secrets');

const ORDER_PATH = '/ordering/2022-10-30/orders';
const BASE = { sandbox: 'https://sandbox.na.business-api.amazon.com', production: 'https://na.business-api.amazon.com' };
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

function baseFor(env) { return BASE[String(env || 'sandbox').toLowerCase()] || BASE.sandbox; }

// envOverride lets us TEST production without flipping the live AMAZON_BUSINESS_ENV
// vault flag (so no auto-order path goes live until we've confirmed the trial).
async function creds(envOverride) {
  const [clientId, clientSecret, refresh, groupId, buyerEmail, paymentRef, region, env] = await Promise.all([
    getSecret('AMAZON_LWA_CLIENT_ID'), getSecret('AMAZON_LWA_CLIENT_SECRET'), getSecret('AMAZON_LWA_REFRESH_TOKEN'),
    getSecret('AMAZON_BUSINESS_GROUP_ID'), getSecret('AMAZON_BUSINESS_BUYER_EMAIL'), getSecret('AMAZON_BUSINESS_PAYMENT_REF'),
    getSecret('AMAZON_BUSINESS_REGION'), getSecret('AMAZON_BUSINESS_ENV'),
  ]);
  const e = String(envOverride || env || 'sandbox').toLowerCase();
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

// Build the documented Ordering-API order payload (POST /ordering/2022-10-30/orders).
// Schema per docs.business.amazon.com/docs/placing-an-order — every attribute is a
// tagged object with an `attributeType` discriminator (the prior shape was guessed
// and would 400 at production).
//   opts: { asin, quantity, unitPrice?, ship:{name,line1,line2,city,state,zip,phone,company},
//           externalId, poNumber?, group?, buyerEmail?, region? }
function buildOrderPayload(opts, c) {
  const ship = opts.ship || {};
  const group = opts.group || c.groupId || '';
  const buyer = opts.buyerEmail || c.buyerEmail || '';
  const region = opts.region || c.region || 'US';
  const ext = String(opts.externalId || ('ant-' + Date.now())).slice(0, 60);
  const li = {
    externalId: 'line-1',
    quantity: opts.quantity || 1,
    attributes: [
      { attributeType: 'SelectedProductReference', productReference: { productReferenceType: 'ProductIdentifier', id: String(opts.asin) } },
    ],
  };
  if (opts.unitPrice != null) {
    li.expectations = [{ expectationType: 'ExpectedUnitPrice', amount: { currencyCode: 'USD', amount: Number(opts.unitPrice) } }];
  }
  return {
    externalId: ext,
    lineItems: [li],
    attributes: [
      { attributeType: 'PurchaseOrderNumber', purchaseOrderNumber: String(opts.poNumber || ext).slice(0, 30) },
      { attributeType: 'BuyerReference', userReference: { userReferenceType: 'UserEmail', emailAddress: buyer } },
      { attributeType: 'BuyingGroupReference', groupReference: { groupReferenceType: 'GroupIdentity', identifier: group } },
      { attributeType: 'Region', region },
      { attributeType: 'SelectedPaymentMethodReference', paymentMethodReference: { paymentMethodReferenceType: 'StoredPaymentMethod' } },
      { attributeType: 'ShippingAddress', address: { addressType: 'PhysicalAddress', fullName: ship.name || 'Customer', phoneNumber: ship.phone || '', companyName: ship.company || '', addressLine1: ship.line1 || '', addressLine2: ship.line2 || '', city: ship.city || '', stateOrRegion: ship.state || '', postalCode: ship.zip || '', countryCode: 'US' } },
    ],
    expectations: [],
  };
}

// place (or trial) an order for one ASIN shipped to a customer address.
// trial=true (default) appends TrialMode so the order validates without buying.
async function placeOrder(opts) {
  const c = await creds(opts.envOverride);
  // Sandbox uses mock data + the doc's example refs, so it doesn't need the real
  // production group/buyer/payment vault keys. Production does.
  if (c.env !== 'sandbox' && !isConfigured(c)) return { ok: false, configured: false, reason: 'amazon_business_not_configured' };
  const token = await accessToken(c);
  const payload = buildOrderPayload(opts, c);
  if (opts.trial !== false) payload.attributes.push({ attributeType: 'TrialMode', trialMode: true });

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
async function authCheck(envOverride) {
  const c = await creds(envOverride);
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

module.exports = { placeOrder, creds, isConfigured, authCheck, baseFor, buildOrderPayload };
