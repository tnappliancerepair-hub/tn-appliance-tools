// One-time hookup for a SECOND Gmail inbox (tnappliance@gmail.com — where the
// Amazon Business + Google Ads receipts/approvals land). Mints a read-only Gmail
// token via the "Ant Ads" WEB OAuth client (same one Search Console uses) — a
// Web client can hold the https redirect URI; the Gmail "AHS Poller" client is
// Desktop-type and CANNOT (that's the redirect_uri_mismatch error).
//
// PREREQ (one console step, done once): Google Cloud → APIs & Services →
// Credentials → "Ant Ads" client → Authorized redirect URIs → add:
//   https://tnapplianceexchange.net/.netlify/functions/gmail2-oauth-callback
//   (also ensure the consent screen lists the .../auth/gmail.readonly scope, and
//    add tnappliance@gmail.com as a Test user if the app is in Testing mode)
//
// THEN: open this link WHILE SIGNED IN AS tnappliance@gmail.com (use an
// incognito window so you don't accidentally authorize the wrong account):
//   https://tnapplianceexchange.net/.netlify/functions/gmail2-oauth-start
'use strict';
const { getSecretPreferVault } = require('./_lib/secrets');

const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/gmail2-oauth-callback';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

exports.handler = async function (event) {
  // ?n=<slot> picks which GMAIL{n}_REFRESH_TOKEN to fill (2..5). Default 2.
  const q = (event && event.queryStringParameters) || {};
  let n = parseInt(q.n, 10); if (!(n >= 2 && n <= 5)) n = 2;

  const id = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_ID')) || (await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'));
  if (!id) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>No Web OAuth client configured. Need <b>GOOGLE_ADS_CLIENT_ID</b> (the "Ant Ads" web client, already set from the Ads/GSC hookup).</p>' };
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', 'gmailn_' + n + '_' + Date.now());
  return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
};
