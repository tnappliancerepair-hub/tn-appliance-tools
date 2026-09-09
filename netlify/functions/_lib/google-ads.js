// Google Ads API connector — OAuth2 (refresh token) + developer token + the
// manager (MCC) login-customer-id. Reads everything from the runtime vault.
// Used to read/manage campaigns once authorized.
//
// Vault keys:
//   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET   (Google Cloud OAuth client)
//   GOOGLE_ADS_REFRESH_TOKEN                          (minted by the oauth-callback)
//   GOOGLE_ADS_DEVELOPER_TOKEN                        (already vaulted)
//   GOOGLE_ADS_MANAGER_ID                             (MCC id, e.g. 160-509-9162)
//   GOOGLE_ADS_API_VERSION   (optional, default "v18")
'use strict';
const { getSecretPreferVault } = require('./secrets');

const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/google-ads-oauth-callback';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

function digits(s) { return String(s || '').replace(/\D/g, ''); }

// These live in the runtime vault (Netlify env is at the 4KB Lambda cap), and the vault is
// a Xano read that can time out when Xano is busy. getSecretPreferVault swallows that and
// hands back '' — so on a cold container a slow read makes a fully-configured account report
// "configured: false". Seen live 2026-09-09: four straight calls to google-ads-performance
// came back not-configured while google-ads-search-terms (warm, cached) served fine.
//
// This matters beyond a confusing message: google-ads-conversion-sweep runs every 6 hours on
// a cold container, so an empty refresh token there is a silently skipped upload.
// One retry — the second pass runs with the table-id cache already warm.
async function readCreds() {
  return Promise.all([
    getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'), getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET'),
    getSecretPreferVault('GOOGLE_ADS_REFRESH_TOKEN'), getSecretPreferVault('GOOGLE_ADS_DEVELOPER_TOKEN'),
    getSecretPreferVault('GOOGLE_ADS_MANAGER_ID'), getSecretPreferVault('GOOGLE_ADS_API_VERSION'),
  ]);
}

async function creds() {
  let [clientId, clientSecret, refresh, devToken, mgr, ver] = await readCreds();
  if (!clientId || !refresh || !devToken) {
    await new Promise((r) => setTimeout(r, 400));
    const again = await readCreds();
    clientId = clientId || again[0]; clientSecret = clientSecret || again[1];
    refresh = refresh || again[2]; devToken = devToken || again[3];
    mgr = mgr || again[4]; ver = ver || again[5];
  }
  // v21 sunsets 2026-08-05 (Google email 2026-07-15). v24 verified live via the
  // version probe (v25 still 404s for us). Override anytime via vault GOOGLE_ADS_API_VERSION.
  return { clientId, clientSecret, refresh, devToken, managerId: digits(mgr), version: (ver || 'v24').trim() };
}

async function accessToken(c) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.clientId, client_secret: c.clientSecret });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('token: ' + JSON.stringify(d).slice(0, 200));
  return d.access_token;
}

function apiHeaders(token, c, loginCidOverride) {
  const h = { Authorization: 'Bearer ' + token, 'developer-token': c.devToken, 'Content-Type': 'application/json' };
  const lcid = loginCidOverride != null ? String(loginCidOverride).replace(/\D/g, '') : c.managerId;
  if (lcid) h['login-customer-id'] = lcid;
  return h;
}

// the simplest authorized call — proves OAuth + dev token + MCC all work.
async function listAccessibleCustomers() {
  const c = await creds();
  if (!c.clientId || !c.clientSecret || !c.refresh || !c.devToken) {
    return { ok: false, configured: false, missing: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN'].filter((k) => !c[{ GOOGLE_ADS_CLIENT_ID: 'clientId', GOOGLE_ADS_CLIENT_SECRET: 'clientSecret', GOOGLE_ADS_REFRESH_TOKEN: 'refresh', GOOGLE_ADS_DEVELOPER_TOKEN: 'devToken' }[k]]) };
  }
  const token = await accessToken(c);
  const url = 'https://googleads.googleapis.com/' + c.version + '/customers:listAccessibleCustomers';
  const r = await fetch(url, { headers: apiHeaders(token, c) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, version: c.version, manager_id: c.managerId, response: d };
}

module.exports = { creds, accessToken, apiHeaders, listAccessibleCustomers, REDIRECT, TOKEN_URL, SCOPE };
