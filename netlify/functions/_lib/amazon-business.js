// Amazon Business Ordering API client — programmatic placeOrder (ship to the
// customer). Auth = Login with Amazon (LWA) refresh token -> access token.
// All credentials come from the runtime vault; if any are missing the caller
// gets {configured:false} and falls back to the manual/one-tap path.
//
// Docs: https://docs.business.amazon.com/docs/placing-an-order
//   POST https://na.business-api.amazon.com/ordering/2022-10-30/orders
//
// Vault keys (set via admin-secrets.html once enrolled):
//   AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_LWA_REFRESH_TOKEN
//   AMAZON_BUSINESS_GROUP_ID      (BuyingGroupReference - GroupIdentity)
//   AMAZON_BUSINESS_BUYER_EMAIL   (BuyerReference - UserEmail)
//   AMAZON_BUSINESS_PAYMENT_REF   (StoredPaymentMethod reference id)
//   AMAZON_BUSINESS_REGION        (default "US")

'use strict';
const { getSecret } = require('./secrets');

const ORDER_URL = 'https://na.business-api.amazon.com/ordering/2022-10-30/orders';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

async function creds() {
  const [clientId, clientSecret, refresh, groupId, buyerEmail, paymentRef, region] = await Promise.all([
    getSecret('AMAZON_LWA_CLIENT_ID'), getSecret('AMAZON_LWA_CLIENT_SECRET'), getSecret('AMAZON_LWA_REFRESH_TOKEN'),
    getSecret('AMAZON_BUSINESS_GROUP_ID'), getSecret('AMAZON_BUSINESS_BUYER_EMAIL'), getSecret('AMAZON_BUSINESS_PAYMENT_REF'),
    getSecret('AMAZON_BUSINESS_REGION'),
  ]);
  return { clientId, clientSecret, refresh, groupId, buyerEmail, paymentRef, region: region || 'US' };
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

  const r = await fetch(ORDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-amz-access-token': token },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, trial: opts.trial !== false, response: d };
}

module.exports = { placeOrder, creds, isConfigured };
