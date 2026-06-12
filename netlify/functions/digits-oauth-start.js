// Step 1 of the one-time Digits hookup: visit this URL once to authorize Ant.
// It bounces you to Digits' consent screen; after you approve, Digits sends you
// to digits-oauth-callback, which hands back the refresh token to paste into
// Netlify env. Requires DIGITS_CLIENT_ID set first.
//
// Open: https://tnapplianceexchange.net/.netlify/functions/digits-oauth-start

'use strict';

const { defaultRedirect } = require('./_lib/digits');

exports.handler = async function () {
  const id = process.env.DIGITS_CLIENT_ID;
  if (!id) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>Set <b>DIGITS_CLIENT_ID</b> (and DIGITS_CLIENT_SECRET) in Netlify env first, then reload.</p>' };
  }
  const u = new URL('https://connect.digits.com/v1/oauth/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', defaultRedirect());
  u.searchParams.set('scope', 'ledger:read source:sync');
  u.searchParams.set('state', 'ant' + Date.now());
  return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
};
