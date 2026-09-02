// OpenAI ChatGPT Ads API connector — the PAID arm of the AI-discovery push. When
// someone asks ChatGPT "who fixes my dryer in Nashville," this is what buys the
// Sponsored spot. Mirrors _lib/google-ads.js but MUCH simpler: OpenAI Ads uses a
// plain Bearer API key (issued in Ads Manager → Settings) — NO OAuth, NO refresh
// token, NO manager/MCC login-cid fallback.
//
// Vault keys (set via admin-secrets.html once Teddy has the account):
//   OPENAI_ADS_API_KEY    (Bearer key from Ads Manager → Settings)
//   OPENAI_ADS_PIXEL_ID   (from the Conversions tab — for the Conversions API pid)
//
// Built DARK: every reader returns { ok:false, configured:false } cleanly until the
// key is vaulted, so nothing throws and nothing charges before Teddy launches.
'use strict';
const { getSecretPreferVault } = require('./secrets');

// Ads Manager API (campaigns/insights) vs the Conversions ("Business Results") API.
const API_BASE = 'https://api.ads.openai.com/v1';
const CONV_BASE = 'https://bzr.openai.com/v1';

async function creds() {
  const [key, pixelId] = await Promise.all([
    getSecretPreferVault('OPENAI_ADS_API_KEY'),
    getSecretPreferVault('OPENAI_ADS_PIXEL_ID'),
  ]);
  return { key: (key || '').trim(), pixelId: (pixelId || '').trim() };
}

function apiHeaders(key) {
  return { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' };
}

// Bounded GET/POST against the Ads Manager API. Never hangs a caller.
async function api(method, path, key, body) {
  const url = API_BASE + path;
  const opts = { method, headers: apiHeaders(key), signal: AbortSignal.timeout(12000) };
  if (body != null) opts.body = JSON.stringify(body);
  let r, d;
  try { r = await fetch(url, opts); d = await r.json().catch(() => ({})); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  return { ok: r.ok, status: r.status, d, err: r.ok ? null : ((d && d.error && (d.error.message || d.error)) || d) };
}

// The simplest authorized call — proves the key works. Mirrors
// google-ads.js listAccessibleCustomers.
async function configured() {
  const c = await creds();
  if (!c.key) return { ok: false, configured: false, missing: ['OPENAI_ADS_API_KEY'] };
  const res = await api('GET', '/ad_account', c.key);
  return {
    ok: res.ok, configured: !!res.ok, status: res.status,
    has_pixel: !!c.pixelId, account: res.ok ? (res.d && (res.d.ad_account || res.d)) : null,
    error: res.ok ? null : res.err,
  };
}

module.exports = { creds, apiHeaders, api, configured, API_BASE, CONV_BASE };
