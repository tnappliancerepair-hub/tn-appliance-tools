// Step 2: Digits redirects here with ?code=... after you approve. We exchange
// it for a refresh token and show it so you can paste it into Netlify env as
// DIGITS_REFRESH_TOKEN (then redeploy). Refresh tokens don't expire.

'use strict';

const { defaultRedirect } = require('./_lib/digits');
const { getSecretPreferVault, setSecret } = require('./_lib/secrets');

function page(title, inner) {
  return '<!DOCTYPE html><html><body style="font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 18px;color:#1d2530">'
    + '<h2>' + title + '</h2>' + inner + '</body></html>';
}

exports.handler = async function (event) {
  const code = (event.queryStringParameters || {}).code;
  if (!code) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: page('Missing authorization code', '<p>Start over at <code>/.netlify/functions/digits-oauth-start</code>.</p>') };

  const id = await getSecretPreferVault('DIGITS_CLIENT_ID');
  const secret = await getSecretPreferVault('DIGITS_CLIENT_SECRET');
  if (!id || !secret) return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: page('Not configured', '<p>Add DIGITS_CLIENT_ID and DIGITS_CLIENT_SECRET to the vault via admin-secrets.html first.</p>') };

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: defaultRedirect(),
    });
    const r = await fetch('https://connect.digits.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const d = await r.json().catch(() => ({}));
    if (!d.refresh_token) {
      return { statusCode: 502, headers: { 'Content-Type': 'text/html' },
        body: page('Token exchange failed', '<pre>' + JSON.stringify(d, null, 2) + '</pre>') };
    }
    // Auto-save the refresh token to the vault — no manual env paste, no
    // redeploy. Digits is live the moment this returns.
    let saved = false;
    try { await setSecret('DIGITS_REFRESH_TOKEN', d.refresh_token); saved = true; } catch (_) {}
    return {
      statusCode: 200, headers: { 'Content-Type': 'text/html' },
      body: page('✅ Digits connected',
        saved
          ? '<p><b>Done — you\'re connected.</b> The refresh token was saved to the vault automatically. Nothing else to do: open the Money hub → <b>Books</b> tab and it pulls your live P&amp;L from Digits.</p>'
          : ('<p>Connected, but the auto-save failed. Add this to the vault as <b>DIGITS_REFRESH_TOKEN</b> via admin-secrets.html:</p>'
             + '<textarea readonly style="width:100%;height:120px;font-size:13px;font-family:monospace" onclick="this.select()">' + d.refresh_token + '</textarea>')),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: page('Error', '<pre>' + (err.message || '') + '</pre>') };
  }
};
