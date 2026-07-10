// frontdoor-keys — reveal ONLY the two Frontdoor identifiers Brian needs to link
// our sandbox key to our account (clears the 403 on the dispatch endpoint):
// the apikey Client ID + API Username. These are identifiers meant to be shared
// with Frontdoor — NOT secrets. The PASSWORD is never returned (masked only).
// Admin-secret gated. Narrow on purpose (not a general secret reader).
//
//   GET ?secret=<VAPI_ADMIN_SECRET>  -> { env, client_id, api_username, password_masked }
'use strict';

const { getSecretFresh } = require('./_lib/secrets');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function mask(s) { s = String(s || ''); if (s.length <= 4) return s ? '••••' : ''; return s.slice(0, 2) + '••••' + s.slice(-2); }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const guard = (await getSecretFresh('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return j(403, { ok: false, error: 'admin secret required (?secret=)' });

  const [clientId, username, password, env] = await Promise.all([
    getSecretFresh('FRONTDOOR_CLIENT_ID'),
    getSecretFresh('FRONTDOOR_API_USERNAME'),
    getSecretFresh('FRONTDOOR_API_PASSWORD'),
    getSecretFresh('FRONTDOOR_ENV'),
  ]);

  return j(200, {
    ok: true,
    env: (env || 'sandbox'),
    client_id: String(clientId || '').trim() || null,
    api_username: String(username || '').trim() || null,
    password_masked: mask(password),
    note: 'Give client_id + api_username to Brian to authorize the dispatch endpoint. Never share the password.',
  });
};
