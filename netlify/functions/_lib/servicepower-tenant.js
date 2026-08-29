// servicepower-tenant — run ServicePower AS a specific shop.
//
// The platform stores each shop's OWN ServicePower servicer login (encrypted, per tenant, via
// tenant-creds). This binds those decrypted creds into vendor-ctx for the duration of a call, so
// the shared connectors (_lib/servicepower dispatch SOAP + _lib/servicepower-claims REST) talk to
// ServicePower as THAT shop — never TN's vault, never another tenant's account. Concurrency-safe
// (AsyncLocalStorage), so two shops' automations can run at once without clobbering each other.
//
// This is the foundation every ServicePower phase builds on:
//   const sp = await spTenant.forCompany(companyId);
//   if (!sp) return;                       // shop hasn't connected ServicePower
//   const jobs   = await sp.getCallInfo({ fromDateTime, toDateTime });   // pull dispatches
//   await sp.updateCallInfo({ ... });                                    // push status
//   const claim  = await sp.retrieveClaims({ callNumber });              // read payment
//   await sp.submitClaims([ claimObj ]);                                 // file the claim (invoice)
'use strict';

const tc = require('./tenant-creds');
const vendorCtx = require('./vendor-ctx');
const sp = require('./servicepower');
const spClaims = require('./servicepower-claims');

// The decrypted { user_id, password, servicer_acct } a shop connected, or null if not connected.
async function credsFor(companyId) {
  if (!companyId) return null;
  const c = await tc.getTenantVendorCreds(companyId, 'servicepower');
  if (!c || !c.user_id || !c.password || !c.servicer_acct) return null;
  return { user_id: String(c.user_id).trim(), password: String(c.password).trim(), servicer_acct: String(c.servicer_acct).trim() };
}

// Run any function with this shop's ServicePower creds bound into context. Low-level escape hatch
// for callers that want to make several connector calls inside one tenant context.
async function withShop(companyId, fn) {
  const creds = await credsFor(companyId);
  if (!creds) return { ok: false, error: 'not_connected', vendor: 'servicepower' };
  return vendorCtx.withVendorCreds({ servicepower: creds }, fn);
}

// A bound handle — every op runs as the shop. Returns null when the shop hasn't connected
// ServicePower, so callers can cleanly skip a tenant that isn't set up.
async function forCompany(companyId) {
  const creds = await credsFor(companyId);
  if (!creds) return null;
  const run = (fn) => vendorCtx.withVendorCreds({ servicepower: creds }, fn);
  return {
    servicer_acct: creds.servicer_acct,
    // dispatch (SOAP)
    getTestService: (msg) => run(() => sp.getTestService(msg)),
    getCallInfo: (args) => run(() => sp.getCallInfo(args || {})),
    updateCallInfo: (args) => run(() => sp.updateCallInfo(args || {})),
    getCallNotes: (args) => run(() => sp.getCallNotes(args || {})),
    getCallAttributes: (args) => run(() => sp.getCallAttributes(args || {})),
    getProductCoverage: (args) => run(() => sp.getProductCoverage(args || {})),
    // claims (REST)
    retrieveClaims: (q) => run(() => spClaims.retrieveClaims(q || {})),
    submitClaims: (claims) => run(() => spClaims.submitClaims(claims)),
  };
}

module.exports = { credsFor, withShop, forCompany };
