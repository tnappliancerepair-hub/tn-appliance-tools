// One-time hookup for a SECOND Gmail inbox (tnappliance@gmail.com — where the
// Amazon Business + Google Ads receipts/approvals land). Reuses the existing,
// production-published Gmail OAuth client and mints a separate read-only token.
//
// PREREQ (one console step, done once): in Google Cloud → the Gmail OAuth client
// → Authorized redirect URIs → add:
//   https://tnapplianceexchange.net/.netlify/functions/gmail2-oauth-callback
//
// THEN: open this link WHILE SIGNED IN AS tnappliance@gmail.com (use an
// incognito window so you don't accidentally authorize the wrong account):
//   https://tnapplianceexchange.net/.netlify/functions/gmail2-oauth-start
'use strict';
const { getSecretPreferVault } = require('./_lib/secrets');

const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/gmail2-oauth-callback';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

exports.handler = async function () {
  const id = (await getSecretPreferVault('GMAIL2_CLIENT_ID')) || (await getSecretPreferVault('GMAIL_CLIENT_ID'));
  if (!id) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
      body: '<p>No Gmail OAuth client configured. Need <b>GMAIL_CLIENT_ID</b> (already set for inbox #1).</p>' };
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', 'gmail2_' + Date.now());
  return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
};
