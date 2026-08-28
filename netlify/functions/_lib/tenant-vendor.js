// tenant-vendor — the credential RESOLVER (the rail that turns "creds stored" into "automations
// run on each shop's accounts"). A per-tenant automation calls credsForTenant(companyId, vendor)
// to get that shop's decrypted vendor creds, then hands them to the shared connector so the
// call authenticates AS the shop. Returns null when the shop hasn't connected that vendor — the
// caller then falls back to TN's own vault creds (so TN's live path is unchanged).
//
// The credential field keys a shop enters (platform-integrations VENDORS catalog) are 1:1 with
// what each connector expects, so this is a thin, named resolver over the encrypted store:
//   servicepower -> { user_id, password, servicer_acct }
//   ahs/frontdoor -> { client_id, api_username, api_password, vendor_id }
//   marcone      -> { client_id, client_secret, customer_no }
//   nsa          -> { portal_user, portal_pass }
'use strict';
const tc = require('./tenant-creds');
const vv = require('./vendor-verify');

// The shop's decrypted creds for a vendor, or null if not connected.
async function credsForTenant(companyId, vendor) {
  if (!companyId || !vendor) return null;
  return tc.getTenantVendorCreds(companyId, vendor);
}

// Live auth probe against the shop's own account for a vendor.
async function verifyForTenant(companyId, vendor) {
  const c = await credsForTenant(companyId, vendor);
  if (!c) return { ok: false, detail: 'not_connected' };
  return vv.verify(vendor, c);
}

module.exports = { credsForTenant, verifyForTenant };
