// vendor-ctx — carries a tenant's vendor creds for the duration of one automation run, so the
// shared connectors can authenticate AS that shop without threading creds through every function.
// Concurrency-safe: uses AsyncLocalStorage, so two tenants' automations running at once never
// clobber each other. When no context is set (TN's normal path), current() returns {} and the
// connectors fall straight through to the vault — TN's behavior is byte-for-byte unchanged.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();

// Run fn with a per-vendor creds map in context, e.g. { servicepower: {...}, marcone: {...} }.
function withVendorCreds(credsByVendor, fn) {
  return als.run({ creds: credsByVendor || {} }, fn);
}

// The override creds for a vendor in the CURRENT async context, or {} if none. Never throws.
function current(vendor) {
  const store = als.getStore();
  if (!store || !store.creds) return {};
  return store.creds[vendor] || {};
}

// True when we're running inside a tenant context for this vendor (i.e. an override exists).
function hasOverride(vendor) {
  const c = current(vendor);
  return !!(c && Object.keys(c).length);
}

module.exports = { withVendorCreds, current, hasOverride };
