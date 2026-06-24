// servicepower-test — owner-gated diagnostic. Calls SPDService getTestService to
// verify connectivity (and, once creds are vaulted, that they're accepted) WITHOUT
// modifying any work order. No secrets leaked.
//   GET /.netlify/functions/servicepower-test?secret=<admin>&env=development|production
'use strict';
const { getSecret } = require('./_lib/secrets');
const sp = require('./_lib/servicepower');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const adminSecret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== adminSecret) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  const configured = await sp.isConfigured();
  let r = {};
  try { r = await sp.getTestService('ant-connectivity-check'); }
  catch (e) { return json(200, { ok: false, configured, error: String((e && e.message) || e) }); }

  return json(200, {
    ok: r.ok,
    configured,
    service_url: await sp.serviceUrl(),
    soap_status: r.status,
    fault: r.fault,
    ack: r.ack,
    detail: (r.raw || '').slice(0, 300),
    note: r.ok ? 'SPDService reachable.' : 'Reachable check — inspect detail. (getTestService may not validate creds; real auth test = a getCallInfo read once we have its schema.)',
  });
};
