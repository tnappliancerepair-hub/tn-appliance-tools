// vizard-check — masked diagnostic: is the Vizard key vaulted + does it authenticate?
// Owner-gated. Does NOT create a billable project (a query probe is free).
//   GET ?secret=<VAPI_ADMIN_SECRET>
'use strict';
const { getSecret } = require('./_lib/secrets');
const vizard = require('./_lib/vizard');

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  const key = await vizard.apiKey();
  if (!key) return json(200, { ok: false, configured: false, note: 'Add VIZARDAI_API_KEY in the vault (Creator tier includes API access).' });
  const r = await vizard.getClips('0'); // free auth probe on a bogus project id
  const masked = String(key).slice(0, 4) + '…' + String(key).slice(-4);
  const authOk = r.status !== 401 && r.status !== 403;
  return json(200, { ok: authOk, configured: true, key: masked, probe_status: r.status, probe_code: r.code, auth: authOk ? 'valid' : 'REJECTED — check the key' });
};
