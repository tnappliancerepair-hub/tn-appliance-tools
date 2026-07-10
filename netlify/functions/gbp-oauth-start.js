// One-time Google Business Profile hookup: visit this URL once to authorize Ant
// to read your Google reviews + post replies. Reuses the "Ant Ads" Google OAuth
// client (same Cloud project) with the business.manage scope; mints a separate
// GBP token (GBP_REFRESH_TOKEN).
//
// PREREQ (two console steps):
//   1) Google Cloud → OAuth client "Ant Ads" → Authorized redirect URIs → add:
//        https://tnapplianceexchange.net/.netlify/functions/gbp-oauth-callback
//   2) Enable the "Google Business Profile API" in the Cloud Console.
//
// Open: https://tnapplianceexchange.net/.netlify/functions/gbp-oauth-start
'use strict';
const { getSecretPreferVault } = require('./_lib/secrets');
const { REDIRECT, SCOPE } = require('./_lib/gbp');

exports.handler = async function () {
  const id = await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID');
  if (!id) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>Add <b>GOOGLE_ADS_CLIENT_ID</b> + <b>GOOGLE_ADS_CLIENT_SECRET</b> to the vault first (you already have these from the Ads/Search Console hookup).</p>' };
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', 'gbp' + Date.now());
  return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
};
