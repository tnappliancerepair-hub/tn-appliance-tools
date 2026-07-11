// gbp-profile — owner-gated read of the live Business Profile so we can audit what
// a customer actually sees (categories, description, services, hours, site, phone,
// service area). Read-only. Built 2026-07-10 to hunt for the "used appliance store"
// signals that pull the wrong (buy-intent) traffic instead of repair customers.
//   GET ?secret=<admin>
'use strict';
const { getSecret } = require('./_lib/secrets');
const gbp = require('./_lib/gbp');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const MASK = ['title', 'categories', 'phoneNumbers', 'websiteUri', 'regularHours',
  'profile', 'serviceArea', 'serviceItems', 'openInfo', 'storefrontAddress', 'labels', 'moreHours'].join(',');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  if (!(await gbp.isConfigured())) return json(200, { ok: false, configured: false });

  try {
    const a = await gbp.listAccounts();
    const accts = (a.data && a.data.accounts) || [];
    if (!accts.length) return json(200, { ok: false, error: 'no_accounts' });
    const acctId = String(accts[0].name).replace(/^accounts\//, '');
    const loc = await gbp.listLocations(acctId);
    const locs = (loc.data && loc.data.locations) || [];
    if (!locs.length) return json(200, { ok: false, error: 'no_locations', data: loc.data });
    const locId = String(locs[0].name).replace(/^locations\//, '');
    const detail = await gbp.api('GET', 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/' + locId + '?readMask=' + encodeURIComponent(MASK));
    return json(200, { ok: detail.ok, status: detail.status, location_id: locId, profile: detail.data });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 240) });
  }
};
