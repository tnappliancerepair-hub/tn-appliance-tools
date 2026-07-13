// gbp.js — Google Business Profile API connector (read reviews + post replies).
// Reuses the shared Google OAuth "Ant Ads" WEB client (GOOGLE_ADS_CLIENT_ID/SECRET,
// same Cloud project as Ads + Search Console) with the business.manage scope; the
// GBP-specific refresh token is vaulted separately as GBP_REFRESH_TOKEN.
//
// Approved 2026-07-10 (case 4-9470000041082). Reviews live on the v4 host
// (mybusiness.googleapis.com/v4/accounts/*/locations/*/reviews); accounts +
// locations come from the v1 account-management / business-information hosts.
'use strict';

const { getSecretPreferVault } = require('./secrets');

const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/gbp-oauth-callback';
const SCOPE = 'https://www.googleapis.com/auth/business.manage';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let _tok = null, _exp = 0;

async function isConfigured() {
  const [i, s, r] = await Promise.all([
    getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'), getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET'), getSecretPreferVault('GBP_REFRESH_TOKEN'),
  ]);
  return !!(i && s && r);
}

async function accessToken(force) {
  if (!force && _tok && Date.now() < _exp - 60000) return _tok;
  const [id, secret, refresh] = await Promise.all([
    getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'), getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET'), getSecretPreferVault('GBP_REFRESH_TOKEN'),
  ]);
  if (!id || !secret || !refresh) throw new Error('GBP not configured (need GOOGLE_ADS_CLIENT_ID/SECRET + GBP_REFRESH_TOKEN)');
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: id, client_secret: secret, refresh_token: refresh });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(12000) });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('GBP token: ' + JSON.stringify(d).slice(0, 200));
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000;
  return _tok;
}

async function api(method, url, bodyObj) {
  const token = await accessToken();
  const r = await fetch(url, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined, signal: AbortSignal.timeout(15000),
  });
  const tx = await r.text(); let j = {}; try { j = JSON.parse(tx); } catch (_) {}
  return { ok: r.ok, status: r.status, data: j, raw: tx };
}

// List the GBP accounts this token can manage (v1 account management).
async function listAccounts() {
  return api('GET', 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
}

// Locations under an account (Business Information API v1). accountId = the bare
// id or the "accounts/123" form. Returns names like "locations/456".
async function listLocations(accountId) {
  const acct = String(accountId).startsWith('accounts/') ? accountId : ('accounts/' + accountId);
  const url = 'https://mybusinessbusinessinformation.googleapis.com/v1/' + acct
    + '/locations?readMask=name,title,storefrontAddress&pageSize=100';
  return api('GET', url);
}

// Reviews for a location (legacy v4 reviews host — the allow-listed one).
// accountId/locationId are bare ids. Review.name comes back as the full
// "accounts/{a}/locations/{l}/reviews/{r}" resource used to reply.
async function listReviews(accountId, locationId, pageToken) {
  const a = String(accountId).replace(/^accounts\//, '');
  const l = String(locationId).replace(/^locations\//, '');
  let url = 'https://mybusiness.googleapis.com/v4/accounts/' + a + '/locations/' + l + '/reviews?pageSize=50&orderBy=updateTime%20desc';
  if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
  return api('GET', url);
}

// Post/replace the owner reply on a review. reviewName = the full resource name.
async function putReply(reviewName, comment) {
  return api('PUT', 'https://mybusiness.googleapis.com/v4/' + reviewName + '/reply', { comment: comment });
}

// Resolve the {accountId, locationId} bare-id pair (localPosts needs both).
async function resolveAccountLocation() {
  const a = await listAccounts();
  const accts = (a.data && a.data.accounts) || [];
  if (!accts.length) throw new Error('no_accounts');
  const accountId = String(accts[0].name).replace(/^accounts\//, '');
  const loc = await listLocations(accountId);
  const locs = (loc.data && loc.data.locations) || [];
  if (!locs.length) throw new Error('no_locations');
  const locationId = String(locs[0].name).replace(/^locations\//, '');
  return { accountId, locationId };
}

// Publish a Business Profile "update" post (localPosts, v4 — the allow-listed host).
// summary = post text; a BOOK/LEARN_MORE call-to-action button links to actionUrl.
// Returns { ok, status, data } — data.name is the created post resource (for delete).
async function createLocalPost({ summary, actionType, actionUrl, mediaUrl }) {
  const { accountId, locationId } = await resolveAccountLocation();
  const bodyObj = { languageCode: 'en-US', summary: String(summary || '').slice(0, 1490), topicType: 'STANDARD' };
  if (actionType) { bodyObj.callToAction = { actionType }; if (actionUrl) bodyObj.callToAction.url = actionUrl; }
  if (mediaUrl) bodyObj.media = [{ mediaFormat: 'PHOTO', sourceUrl: mediaUrl }];
  const url = 'https://mybusiness.googleapis.com/v4/accounts/' + accountId + '/locations/' + locationId + '/localPosts';
  return api('POST', url, bodyObj);
}

// Delete a local post by its full resource name (used to clean up a test post).
async function deleteLocalPost(postName) {
  return api('DELETE', 'https://mybusiness.googleapis.com/v4/' + String(postName).replace(/^\/+/, ''));
}

module.exports = { REDIRECT, SCOPE, TOKEN_URL, isConfigured, accessToken, api, listAccounts, listLocations, listReviews, putReply, resolveAccountLocation, createLocalPost, deleteLocalPost };
