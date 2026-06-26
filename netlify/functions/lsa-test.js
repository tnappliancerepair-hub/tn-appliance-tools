// lsa-test — owner-gated check that the Local Services Ads reporting is wired.
// Reuses the Google Ads OAuth. Until Basic Access is approved it'll 403 (test
// token) — that's expected and rides the same approval clock as the Ads API.
//   GET ?secret=<admin>[&days=30]
'use strict';
const { getSecret } = require('./_lib/secrets');
const lsa = require('./_lib/lsa');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(1, Math.min(31, parseInt(q.days, 10) || 30));
  try { return json(200, await lsa.accountReports(days)); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};
