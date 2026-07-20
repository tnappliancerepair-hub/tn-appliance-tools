// Owner-gated diagnostic: shows (masked) what TikTok keys are actually readable
// from the vault, across the likely name variants — so we can spot a mis-typed
// vault entry name. GET ?secret=<VAPI_ADMIN_SECRET>
'use strict';
const { getSecret, getSecretPreferVault } = require('./_lib/secrets');

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
function mask(v) { return v ? (v.slice(0, 8) + '…(' + v.length + ' chars)') : null; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  const names = [
    'TIKTOK_SANDBOX_CLIENT_KEY', 'TIKTOK_SANDBOX_CLIENT_SECRET',
    'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
    'TIKTOK_SANDBOX_KEY', 'TIKTOK_SANDBOX_SECRET',
    'TIKTOK_CLIENT_KEY_SANDBOX', 'TIKTOK_CLIENT_SECRET_SANDBOX',
    'TIK_TOK_SANDBOX_CLIENT_KEY', 'TIKTOK_SANDBOX_CLIENTKEY',
  ];
  const out = {};
  for (const n of names) out[n] = mask(await getSecretPreferVault(n));

  // Connection status: did the OAuth complete + vault the refresh token?
  const refresh = await getSecretPreferVault('TIKTOK_REFRESH_TOKEN');
  const openId = await getSecretPreferVault('TIKTOK_OPEN_ID');
  const scope = await getSecretPreferVault('TIKTOK_SCOPE');
  const connected = {
    TIKTOK_REFRESH_TOKEN: mask(refresh),
    TIKTOK_OPEN_ID: openId || null,
    TIKTOK_SCOPE: scope || null,
    is_connected: !!refresh,
  };

  return json(200, { found: out, connected, note: 'sbawcllk… = the sandbox key; awwg0qc0… = production' });
};
