// One-time Search Console hookup: visit this URL once to authorize Ant to READ
// your organic search data. Reuses the Google Ads OAuth client (same Cloud
// project) with the read-only webmasters scope; mints a separate GSC token.
//
// PREREQ (one console step): in Google Cloud → the OAuth client "Ant Ads" →
// Authorized redirect URIs → add:
//   https://tnapplianceexchange.net/.netlify/functions/gsc-oauth-callback
//
// Open: https://tnapplianceexchange.net/.netlify/functions/gsc-oauth-start
'use strict';
const { getSecretPreferVault } = require('./_lib/secrets');
const { REDIRECT, SCOPE } = require('./_lib/search-console');

exports.handler = async function () {
  const id = await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID');
  if (!id) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>Add <b>GOOGLE_ADS_CLIENT_ID</b> + <b>GOOGLE_ADS_CLIENT_SECRET</b> to the vault first (you already have these from the Ads hookup).</p>' };
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', 'gsc' + Date.now());
  return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
};
