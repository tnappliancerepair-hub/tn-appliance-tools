// Google redirects here after you approve the SECOND inbox. Exchanges the code
// for a refresh token and AUTO-SAVES it to the vault as GMAIL2_REFRESH_TOKEN.
// No paste, no redeploy. After this, the search tool + the API watchers scan
// tnappliance@gmail.com too.
'use strict';
const { getSecretPreferVault, setSecret } = require('./_lib/secrets');

const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/gmail2-oauth-callback';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function page(title, inner) {
  return '<!DOCTYPE html><html><body style="font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 18px;color:#1d2530">'
    + '<h2>' + title + '</h2>' + inner + '</body></html>';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.error) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: page('Authorization declined', '<pre>' + JSON.stringify(q, null, 2) + '</pre>') };
  const code = q.code;
  if (!code) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: page('Missing authorization code', '<p>Start over at <code>/.netlify/functions/gmail2-oauth-start</code>.</p>') };

  // Which inbox slot this connect was for, carried in state ('gmailn_<n>_<ts>').
  let n = 2;
  const mm = String(q.state || '').match(/^gmailn_(\d+)_/);
  if (mm) { const v = parseInt(mm[1], 10); if (v >= 2 && v <= 5) n = v; }
  const TOKEN_KEY = 'GMAIL' + n + '_REFRESH_TOKEN';

  const id = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_ID')) || (await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'));
  const secret = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_SECRET')) || (await getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET'));
  if (!id || !secret) return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: page('Not configured', '<p>Web OAuth client (GOOGLE_ADS_CLIENT_ID/SECRET) missing.</p>') };

  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: id, client_secret: secret, code, redirect_uri: REDIRECT });
    const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const d = await r.json().catch(() => ({}));
    if (!d.refresh_token) {
      return { statusCode: 502, headers: { 'Content-Type': 'text/html' },
        body: page('Token exchange failed', '<p>No refresh_token returned. If you authorized this inbox before, revoke at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> and run the start link again (in an incognito window, signed in as the inbox you are adding).</p><pre>' + JSON.stringify(d, null, 2) + '</pre>') };
    }
    let saved = false;
    try { await setSecret(TOKEN_KEY, d.refresh_token); saved = true; } catch (_) {}
    // Capture WHICH address this slot is, so gmail-send can map a "from" to the right
    // token, and confirm the send scope was actually granted.
    let email = '', hasSend = /gmail\.send/.test(String(d.scope || ''));
    try {
      const pr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + d.access_token } });
      const pj = await pr.json().catch(() => ({}));
      email = pj.emailAddress || '';
      if (email) { try { await setSecret('GMAIL' + n + '_ACCOUNT_EMAIL', email); } catch (_) {} }
    } catch (_) {}
    return {
      statusCode: 200, headers: { 'Content-Type': 'text/html' },
      body: page('✅ Inbox #' + n + ' connected' + (email ? ' — ' + email : ''),
        saved
          ? '<p><b>Done.</b> Ant can now read <b>and ' + (hasSend ? 'send/reply from' : 'read') + '</b> this inbox (slot ' + n + ')'
            + (email ? ' — <b>' + email + '</b>' : '') + '.'
            + (hasSend ? '' : '<br><span style="color:#b45309">⚠️ Send permission was NOT granted — make sure the gmail.send scope is on the OAuth consent screen, then run this link again.</span>') + '</p>'
          : ('<p>Connected, but auto-save failed. Add this to the vault as <b>' + TOKEN_KEY + '</b>:</p><textarea readonly style="width:100%;height:120px;font-family:monospace" onclick="this.select()">' + d.refresh_token + '</textarea>')),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: page('Error', '<pre>' + (err.message || '') + '</pre>') };
  }
};
