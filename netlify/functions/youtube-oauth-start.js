// One-time YouTube hookup: visit this URL once to authorize Ant to upload videos
// to the business's own YouTube channel. Reuses the "Ant Ads" Google OAuth client
// (same Cloud project) with the youtube.upload scope; mints YOUTUBE_REFRESH_TOKEN.
//
// PREREQ (one console step): Google Cloud → OAuth client "Ant Ads" → Authorized
// redirect URIs → add:
//   https://tnapplianceexchange.net/.netlify/functions/youtube-oauth-callback
// Also enable the "YouTube Data API v3" in that project, and (if the app is in
// Testing) add the owner's Google account as a Test user.
//
// Open: https://tnapplianceexchange.net/.netlify/functions/youtube-oauth-start
'use strict';
const { getSecretPreferVault } = require('./_lib/secrets');
const { REDIRECT, SCOPE } = require('./_lib/youtube');

exports.handler = async function () {
  const id = await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID');
  if (!id) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>Add <b>GOOGLE_ADS_CLIENT_ID</b> + <b>GOOGLE_ADS_CLIENT_SECRET</b> to the vault first (you already have these from the Ads/GSC hookup).</p>' };
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', 'yt' + Date.now());
  return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
};
