// Step 1 of the one-time Facebook hookup: visit this URL once (logged in as a
// TN Appliance page admin) to authorize the "TN Appliance Ant" app. It bounces
// you to Facebook's consent screen; after you approve, Facebook sends you to
// social-fb-oauth-callback, which mints a long-lived Page token and auto-vaults
// SOCIAL_FB_PAGE_TOKEN / SOCIAL_FB_PAGE_ID / SOCIAL_IG_USER_ID.
//
// Requires SOCIAL_FB_APP_ID + SOCIAL_FB_APP_SECRET in the vault first, AND the
// callback URL added to the app's Facebook Login → Valid OAuth Redirect URIs.
//
// Open: https://tnapplianceexchange.net/.netlify/functions/social-fb-oauth-start
'use strict';

const { defaultRedirect, SCOPES } = require('./_lib/social-fb');
const { getSecretPreferVault } = require('./_lib/secrets');

exports.handler = async function () {
  const appId = await getSecretPreferVault('SOCIAL_FB_APP_ID');
  if (!appId) {
    return {
      statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>Add <b>SOCIAL_FB_APP_ID</b> and <b>SOCIAL_FB_APP_SECRET</b> to the vault via <b>admin-secrets.html</b> first, then reload.</p>',
    };
  }
  const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', defaultRedirect());
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', 'ant' + Date.now());
  return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
};
