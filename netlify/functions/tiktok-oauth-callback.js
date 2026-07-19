// Step 2: TikTok redirects here with ?code=... after you approve. We exchange the
// code for tokens and vault TIKTOK_REFRESH_TOKEN + TIKTOK_OPEN_ID (+ scope). The
// refresh token is what the auto-poster uses to mint access tokens on demand.
'use strict';

const { tokenFromCode } = require('./_lib/tiktok');
const { setSecret } = require('./_lib/secrets');

function page(title, inner) {
  return '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 18px;color:#1d2530;line-height:1.6">'
    + '<h2>' + title + '</h2>' + inner + '</body></html>';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.error) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' },
      body: page('TikTok returned an error', '<pre>' + JSON.stringify(q, null, 2) + '</pre>') };
  }
  if (!q.code) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' },
      body: page('Missing authorization code', '<p>Start over at <code>/.netlify/functions/tiktok-oauth-start</code>.</p>') };
  }

  const t = await tokenFromCode(q.code);
  if (!t.ok || !t.data.refresh_token) {
    return { statusCode: 502, headers: { 'Content-Type': 'text/html' },
      body: page('Token exchange failed', '<pre>' + JSON.stringify(t.data, null, 2) + '</pre>') };
  }

  const res = {};
  res.refresh = await setSecret('TIKTOK_REFRESH_TOKEN', t.data.refresh_token);
  if (t.data.open_id) res.open = await setSecret('TIKTOK_OPEN_ID', String(t.data.open_id));
  if (t.data.scope) res.scope = await setSecret('TIKTOK_SCOPE', String(t.data.scope));

  const okAll = !!res.refresh;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html' },
    body: page(okAll ? '✅ TikTok connected' : '⚠️ Connected, but a vault write failed',
      '<p><b>Open ID:</b> ' + (t.data.open_id || '(none)') + '</p>'
      + '<p><b>Scopes granted:</b> ' + (t.data.scope || '(none)') + '</p>'
      + '<p><b>Refresh token:</b> ' + (res.refresh ? 'vaulted ✅' : 'FAILED ❌') + '</p>'
      + (okAll ? '<p style="margin-top:16px">That\'s it — tell Claude "TikTok connected."</p>'
               : '<p style="color:#b23">Re-run the start link.</p>')) };
};
