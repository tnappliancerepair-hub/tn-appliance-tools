// Digits Connect API client (OAuth 2.0). Refresh tokens don't expire, so we
// store DIGITS_REFRESH_TOKEN once and mint short-lived access tokens per call.
//
// Env (Netlify):
//   DIGITS_CLIENT_ID, DIGITS_CLIENT_SECRET  — from the Digits "Create App" page
//   DIGITS_REFRESH_TOKEN                    — from the one-time OAuth authorize
//   DIGITS_REDIRECT_URI (optional)          — defaults to the callback function

'use strict';

const BASE = 'https://connect.digits.com/v1';
// Creds are read VAULT-FIRST: the production values live in the Xano app_config
// vault because Netlify env is full (4KB cap) and can't be edited. Env stays as
// a fallback so older deploys keep working.
const { getSecretPreferVault } = require('./secrets');

function defaultRedirect() {
  return process.env.DIGITS_REDIRECT_URI
    || 'https://tnapplianceexchange.net/.netlify/functions/digits-oauth-callback';
}

// {id, secret, refresh} — vault-first, env fallback.
async function getCreds() {
  const [id, secret, refresh] = await Promise.all([
    getSecretPreferVault('DIGITS_CLIENT_ID'),
    getSecretPreferVault('DIGITS_CLIENT_SECRET'),
    getSecretPreferVault('DIGITS_REFRESH_TOKEN'),
  ]);
  return { id, secret, refresh };
}

async function isConnected() {
  const { id, secret, refresh } = await getCreds();
  return !!(id && secret && refresh);
}

async function getAccessToken() {
  const { id, secret, refresh } = await getCreds();
  if (!id || !secret || !refresh) {
    throw new Error('Digits not connected yet (missing DIGITS_CLIENT_ID / DIGITS_CLIENT_SECRET / DIGITS_REFRESH_TOKEN)');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: id,
    client_secret: secret,
    refresh_token: refresh,
  });
  const r = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw new Error('Digits token refresh failed (' + r.status + '): ' + (d.error_description || d.error || ''));
  }
  return d.access_token;
}

async function apiGet(path, token) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: 'Bearer ' + token } });
  const text = await r.text();
  if (!r.ok) throw new Error('Digits GET ' + path + ' -> ' + r.status + ' ' + text.slice(0, 200));
  try { return JSON.parse(text); } catch (_) { return {}; }
}

module.exports = { BASE, defaultRedirect, getCreds, isConnected, getAccessToken, apiGet };
