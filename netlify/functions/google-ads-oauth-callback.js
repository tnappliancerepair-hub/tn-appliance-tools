// Step 2: Google redirects here with ?code=... after you approve. We exchange it
// for a refresh token and AUTO-SAVE it to the vault as GOOGLE_ADS_REFRESH_TOKEN.
// No manual paste, no redeploy — the Ads API is wired the moment this returns.
'use strict';
const { getSecretPreferVault, setSecret } = require('./_lib/secrets');
const { REDIRECT, TOKEN_URL } = require('./_lib/google-ads');

function page(title, inner) {
  return '<!DOCTYPE html><html><body style="font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 18px;color:#1d2530">'
    + '<h2>' + title + '</h2>' + inner + '</body></html>';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.error) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: page('Authorization declined', '<pre>' + JSON.stringify(q, null, 2) + '</pre>') };
  const code = q.code;
  if (!code) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: page('Missing authorization code', '<p>Start over at <code>/.netlify/functions/google-ads-oauth-start</code>.</p>') };

  const id = await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID');
  const secret = await getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET');
  if (!id || !secret) return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: page('Not configured', '<p>Add GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET to the vault first.</p>') };

  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: id, client_secret: secret, code, redirect_uri: REDIRECT });
    const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const d = await r.json().catch(() => ({}));
    if (!d.refresh_token) {
      return { statusCode: 502, headers: { 'Content-Type': 'text/html' },
        body: page('Token exchange failed', '<p>No refresh_token returned. Most common cause: the OAuth consent was already granted once — revoke Ant\'s access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> then run the start link again (it forces a fresh consent).</p><pre>' + JSON.stringify(d, null, 2) + '</pre>') };
    }
    let saved = false;
    try { await setSecret('GOOGLE_ADS_REFRESH_TOKEN', d.refresh_token); saved = true; } catch (_) {}
    return {
      statusCode: 200, headers: { 'Content-Type': 'text/html' },
      body: page('✅ Google Ads connected',
        saved
          ? '<p><b>Done — you\'re connected.</b> The refresh token was saved to the vault automatically. Verify it works: open <code>/.netlify/functions/google-ads-test?secret=YOUR_ADMIN</code> — it should list your accessible Ads accounts.</p>'
          : ('<p>Connected, but auto-save failed. Add this to the vault as <b>GOOGLE_ADS_REFRESH_TOKEN</b> via admin-secrets.html:</p>'
             + '<textarea readonly style="width:100%;height:120px;font-size:13px;font-family:monospace" onclick="this.select()">' + d.refresh_token + '</textarea>')),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: page('Error', '<pre>' + (err.message || '') + '</pre>') };
  }
};
