// google-ads-test — owner-gated proof that the Google Ads API is wired: mints an
// access token from the vaulted refresh token + dev token + MCC, and lists the
// Ads accounts Ant can reach. Run after the OAuth callback saves the refresh token.
//   GET ?secret=<admin>
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  try {
    // probe versions to find the live one (Google retires old ones ~3x/yr)
    const c = await ads.creds();
    if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false, missing: 'creds' });
    const token = await ads.accessToken(c);
    const tries = [];
    for (const v of ['v21', 'v20', 'v19', 'v18', 'v17']) {
      const url = 'https://googleads.googleapis.com/' + v + '/customers:listAccessibleCustomers';
      let r, d;
      try { r = await fetch(url, { headers: ads.apiHeaders(token, c) }); d = await r.json().catch(() => ({})); } catch (e) { tries.push({ v, err: String(e.message || e) }); continue; }
      tries.push({ v, status: r.status });
      if (r.status !== 404) return json(200, { ok: r.ok, working_version: v, status: r.status, manager_id: c.managerId, response: d, version_probe: tries });
    }
    return json(200, { ok: false, error: 'no live API version found', version_probe: tries });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
