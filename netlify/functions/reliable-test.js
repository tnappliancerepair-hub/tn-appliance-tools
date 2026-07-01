// reliable-test — owner-gated smoke test for the Reliable Parts connector.
// Confirms config is vaulted, auth works, and (optionally) runs a real lookup.
//   GET ?secret=<admin>                 -> config + auth check
//   GET ?secret=<admin>&part=DA97-22162A -> also run a live part lookup
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const reliable = require('./_lib/reliable');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const mode = await reliable.authMode();
  const configured = await reliable.isConfigured();
  const base = await reliable.baseUrl();
  const out = { ok: true, configured, auth_mode: mode, base_url: base };

  if (!configured) {
    out.ok = false;
    out.note = 'Vault the Reliable creds first (RELIABLE_* in admin-secrets.html). Needed for ' + mode + ' mode: ' +
      (mode === 'apikey' ? 'RELIABLE_API_KEY' : mode === 'basic' ? 'RELIABLE_USER + RELIABLE_PASS' : 'RELIABLE_CLIENT_ID + RELIABLE_CLIENT_SECRET') +
      ' (+ RELIABLE_BASE_URL). Also set RELIABLE_LOOKUP_PATH / RELIABLE_ORDER_PATH / RELIABLE_TOKEN_URL from Alex\'s spec.';
    return json(200, out);
  }

  // auth check
  try {
    if (mode === 'oauth') { const t = await reliable.getToken(true); out.token_acquired = !!t; }
    else { out.token_acquired = 'n/a (' + mode + ')'; }
  } catch (e) { out.ok = false; out.auth_error = String((e && e.message) || e).slice(0, 240); return json(200, out); }

  // optional live lookup
  if (q.part) {
    try {
      const r = await reliable.lookupPart(String(q.part));
      out.lookup = r.ok ? { count: (r.results || []).length, sample: (r.results || []).slice(0, 3) } : { error: r.error, status: r.status };
    } catch (e) { out.lookup_error = String((e && e.message) || e).slice(0, 240); }
  }
  return json(200, out);
};
