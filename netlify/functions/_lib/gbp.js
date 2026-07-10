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

module.exports = { REDIRECT, SCOPE, TOKEN_URL, isConfigured, accessToken, api, listAccounts };
