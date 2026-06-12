// Step 2: Digits redirects here with ?code=... after you approve. We exchange
// it for a refresh token and show it so you can paste it into Netlify env as
// DIGITS_REFRESH_TOKEN (then redeploy). Refresh tokens don't expire.

'use strict';

const { defaultRedirect } = require('./_lib/digits');

function page(title, inner) {
  return '<!DOCTYPE html><html><body style="font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 18px;color:#1d2530">'
    + '<h2>' + title + '</h2>' + inner + '</body></html>';
}

exports.handler = async function (event) {
  const code = (event.queryStringParameters || {}).code;
  if (!code) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: page('Missing authorization code', '<p>Start over at <code>/.netlify/functions/digits-oauth-start</code>.</p>') };

  const id = process.env.DIGITS_CLIENT_ID;
  const secret = process.env.DIGITS_CLIENT_SECRET;
  if (!id || !secret) return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: page('Not configured', '<p>Set DIGITS_CLIENT_ID and DIGITS_CLIENT_SECRET in Netlify env first.</p>') };

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
    return {
      statusCode: 200, headers: { 'Content-Type': 'text/html' },
      body: page('✅ Digits connected',
        '<p>Paste this into Netlify env as <b>DIGITS_REFRESH_TOKEN</b>, then trigger a redeploy:</p>'
        + '<textarea readonly style="width:100%;height:120px;font-size:13px;font-family:monospace" onclick="this.select()">' + d.refresh_token + '</textarea>'
        + '<p style="color:#8a93a1;font-size:13px">Keep this secret. Once it\'s in env, the Money hub “Books” tab pulls your live P&amp;L from Digits.</p>'),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: page('Error', '<pre>' + (err.message || '') + '</pre>') };
  }
};
