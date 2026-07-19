// Step 1 of the one-time TikTok hookup: visit this URL once (logged in as the
// TN Appliance TikTok account) to authorize the app. Bounces to TikTok's consent
// screen; after approval, TikTok sends you to tiktok-oauth-callback which vaults
// TIKTOK_REFRESH_TOKEN + TIKTOK_OPEN_ID.
//
// Requires TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET in the vault AND the redirect
// URI registered in the app's Login Kit config.
'use strict';

const { authorizeUrl } = require('./_lib/tiktok');

exports.handler = async function () {
  const url = await authorizeUrl('ant' + '_tiktok');
  if (!url) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>Add <b>TIKTOK_CLIENT_KEY</b> + <b>TIKTOK_CLIENT_SECRET</b> to the vault first.</p>' };
  }
  return { statusCode: 302, headers: { Location: url }, body: '' };
};
