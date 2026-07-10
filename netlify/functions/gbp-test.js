// gbp-test — owner-gated: confirm the Google Business Profile hookup works.
//   GET ?secret=<admin>  -> { configured, accounts | error }
'use strict';
const { getSecret } = require('./_lib/secrets');
const gbp = require('./_lib/gbp');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  if (!(await gbp.isConfigured())) {
    return json(200, { ok: false, configured: false, note: 'authorize first at /.netlify/functions/gbp-oauth-start' });
  }
  try {
    const r = await gbp.listAccounts();
    return json(200, { ok: r.ok, configured: true, status: r.status, accounts: (r.data && r.data.accounts) || r.data });
  } catch (e) {
    return json(200, { ok: false, configured: true, error: String((e && e.message) || e).slice(0, 240) });
  }
};
