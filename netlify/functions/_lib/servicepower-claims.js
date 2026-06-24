// servicepower-claims.js — connector for the ServicePower ServiceClaims API
// (REST/JSON, NOT SOAP — separate from the dispatch SPDService connector).
//
// Lets Ant READ claim status + payment data (and later SUBMIT claims) for our
// SquareTrade/NSA warranty jobs → kills manual portal claim-checking + payment
// reconciliation. Reuses the SAME vaulted servicer credentials as dispatch.
//
// Auth: JSON body `authentication:{userId,password}` (same user/pass as the HUB login
//   / dispatch API — userId & password are each max 10 chars). NOT a header.
// Vault (getSecret, env-first then Xano):
//   SERVICEPOWER_USER_ID   - ServiceDispatch UserID (≤10 char)
//   SERVICEPOWER_PASSWORD  - password (≤10 char)
//   SERVICEPOWER_SVCR_ACCT - servicer account (TNA00001) — used as serviceCenterNumber
//   SERVICEPOWER_ENV       - 'production' (default) | 'development'
//
// Claims Retrieval URLs (North America) — from the Claims Retrieval v1.2 guide §5.1:
//   prod: https://claimworks.servicepower.com:8443/services/claim/v1/retrieval
//   test: https://upgdev.servicepower.com:8443/services/claim/v1/retrieval
// Spec: docs/servicepower-claims-api-spec-2026-06-24.md
'use strict';

const { getSecret, getSecretFresh } = require('./secrets');

async function isProd() {
  const env = ((await getSecretFresh('SERVICEPOWER_ENV')) || 'production').toLowerCase();
  return env !== 'development';
}

async function retrievalUrl() {
  return (await isProd())
    ? 'https://claimworks.servicepower.com:8443/services/claim/v1/retrieval'
    : 'https://upgdev.servicepower.com:8443/services/claim/v1/retrieval';
}

async function isConfigured() {
  const [u, p, a] = await Promise.all([
    getSecret('SERVICEPOWER_USER_ID'), getSecret('SERVICEPOWER_PASSWORD'), getSecret('SERVICEPOWER_SVCR_ACCT'),
  ]);
  return !!(u && p && a);
}

async function auth() {
  const userId = String(await getSecretFresh('SERVICEPOWER_USER_ID') || '').trim();
  const password = String(await getSecretFresh('SERVICEPOWER_PASSWORD') || '').trim();
  if (!userId || !password) throw new Error('ServicePower creds not in vault (SERVICEPOWER_USER_ID / _PASSWORD)');
  return { userId, password };
}

// Retrieve claims. All search fields optional EXCEPT what the server requires
// (manufacturerName is documented mandatory; serviceCenterNumber required for a
// servicer user — defaults to the vaulted SvcrAcct). Pass any of:
//   manufacturerName, serviceCenterNumber, claimIdentifier, claimBatchNumber,
//   claimSequenceNumber, claimNumber, callNumber
// READ-ONLY — safe to call anytime.
async function retrieveClaims(q = {}) {
  const a = await auth();
  const svcAcct = q.serviceCenterNumber != null
    ? String(q.serviceCenterNumber)
    : String(await getSecretFresh('SERVICEPOWER_SVCR_ACCT') || '').trim();
  // All our ServicePower work dispatches from ONE client: "SQUARE TRADE". Default to it
  // (overridable via vault SERVICEPOWER_MFG_NAME) so callers only pass the call/dispatch number.
  const mfgName = (q.manufacturerName != null && q.manufacturerName !== '')
    ? String(q.manufacturerName)
    : ((await getSecretFresh('SERVICEPOWER_MFG_NAME')) || 'SQUARE TRADE');
  const payload = {
    manufacturerName: String(mfgName || ''),
    serviceCenterNumber: svcAcct,
    claimIdentifier: String(q.claimIdentifier || ''),
    claimBatchNumber: Number(q.claimBatchNumber || 0),
    claimSequenceNumber: Number(q.claimSequenceNumber || 0),
    claimNumber: String(q.claimNumber || ''),
    callNumber: String(q.callNumber || ''),
    authentication: { userId: a.userId, password: a.password },
  };
  const url = await retrievalUrl();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch (_) {}
  const responseCode = data && (data.responseCode || data.responsecode);
  const ok = r.ok && String(responseCode || '').toUpperCase() === 'OK';
  return {
    ok,
    http_status: r.status,
    response_code: responseCode || null,           // "OK" | "ER"
    transaction_id: (data && data.transactionId) || null,
    claims: (data && Array.isArray(data.claims)) ? data.claims.map(normClaim) : [],
    messages: (data && Array.isArray(data.messages)) ? data.messages.map((m) => (m && m.message) || '').filter(Boolean) : [],
    url,
    // redact creds from any echoed payload
    sent: { ...payload, authentication: { userId: a.userId, password: '***' } },
    raw: text.slice(0, 4000),
  };
}

// CCYYMMDD numeric → "YYYY-MM-DD" (0/empty → null)
function ymd(n) {
  const s = String(n || '').replace(/\D/g, '');
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function normClaim(c) {
  c = c || {};
  return {
    claim_number: c.claimNumber || '',
    claim_identifier: c.claimIdentifier || '',
    claim_batch_number: c.claimBatchNumber || '',
    claim_sequence_number: c.claimSequenceNumber || '',
    status_code: c.claimStatusCode || '',
    status_description: c.claimStatusDescription || '',
    call_number: c.callNumber || '',
    authorization_number: c.authorizationNumber || '',
    brand: c.brandName || '', product: c.productName || '',
    model: c.modelNumber || '', serial: c.serialNumber || '',
    servicer_number: c.servicerNumber || '', servicer_name: c.servicerName || '',
    received_date: ymd(c.receivedDate), edited_date: ymd(c.editedDate),
    payment_type: c.paymentType || '', payment_method: c.paymentMethod || '',
    payment_amount: Number(c.paymentAmount || 0),
    payment_date: ymd(c.paymentDate), period_ending_date: ymd(c.periodEndingDate),
    payment_transaction_number: c.paymentTransactionNumber || '',
    paid_labor: Number(c.paidLaborAmount || 0), paid_parts: Number(c.paidPartsAmount || 0),
    paid_parts_handling: Number(c.paidPartsHandlingAmount || 0), paid_travel: Number(c.paidTravelAmount || 0),
    paid_other: Number(c.paidOtherAmount || 0), paid_mileage: Number(c.paidMileageAmount || 0),
    paid_shipping: Number(c.paidShippingAmount || 0), paid_freight: Number(c.paidFreightAmount || 0),
    paid_incentive: Number(c.paidIncentiveAmount || 0),
    paid_federal_tax: Number(c.paidFederalTaxAmount || 0), paid_state_tax: Number(c.paidStateTaxAmount || 0),
    paid_total: Number(c.paidTotal || 0),
  };
}

module.exports = { isConfigured, isProd, retrievalUrl, retrieveClaims, normClaim };
