// Step 1 of the one-time Google Ads hookup: visit this URL once to authorize Ant.
// Bounces you to Google's consent screen; after you approve, Google sends you to
// google-ads-oauth-callback, which mints + auto-vaults the refresh token.
// Requires GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET in the vault first.
//
// Open: https://tnapplianceexchange.net/.netlify/functions/google-ads-oauth-start
'use strict';
const { getSecretPreferVault } = require('./_lib/secrets');
const { REDIRECT, SCOPE } = require('./_lib/google-ads');

exports.handler = async function () {
  const id = await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID');
  if (!id) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>Add <b>GOOGLE_ADS_CLIENT_ID</b> and <b>GOOGLE_ADS_CLIENT_SECRET</b> to the vault via <b>admin-secrets.html</b> first, then reload this page.</p>' };
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');   // required to get a refresh token
  u.searchParams.set('prompt', 'consent');        // force the refresh token even on re-auth
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', 'ant' + Date.now());
  return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
};
