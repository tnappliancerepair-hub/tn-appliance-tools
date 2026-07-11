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

async function resolveLocation() {
  const a = await gbp.listAccounts();
  const accts = (a.data && a.data.accounts) || [];
  if (!accts.length) throw new Error('no_accounts');
  const acctId = String(accts[0].name).replace(/^accounts\//, '');
  const loc = await gbp.listLocations(acctId);
  const locs = (loc.data && loc.data.locations) || [];
  if (!locs.length) throw new Error('no_locations');
  return String(locs[0].name).replace(/^locations\//, '');
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const secret = q.secret || body.secret;
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  if (!(await gbp.isConfigured())) return json(200, { ok: false, configured: false });

  try {
    const locId = await resolveLocation();

    // POST { description } -> patch the profile description (live edit).
    if (event.httpMethod === 'POST' && typeof body.description === 'string') {
      const desc = body.description.trim();
      if (!desc) return json(400, { ok: false, error: 'empty description' });
      const r = await gbp.api('PATCH',
        'https://mybusinessbusinessinformation.googleapis.com/v1/locations/' + locId + '?updateMask=profile.description',
        { profile: { description: desc } });
      return json(200, { ok: r.ok, status: r.status, updated: r.ok ? 'profile.description' : null, chars: desc.length, data: r.ok ? undefined : r.data });
    }

    // GET -> read-only audit
    const detail = await gbp.api('GET', 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/' + locId + '?readMask=' + encodeURIComponent(MASK));
    return json(200, { ok: detail.ok, status: detail.status, location_id: locId, profile: detail.data });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 240) });
  }
};
