// search-console — Google Search Console (organic SEO) connector. Reuses the
// same Google Cloud OAuth client as Google Ads (GOOGLE_ADS_CLIENT_ID/SECRET) but
// a SEPARATE refresh token (GSC_REFRESH_TOKEN) minted with the read-only
// webmasters scope. Lets Ant read what the site actually ranks for: queries,
// position, clicks, impressions, CTR — the organic scoreboard.
//
// Vault keys:
//   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET   (shared OAuth client)
//   GSC_REFRESH_TOKEN                                 (minted by gsc-oauth-callback)
//   GSC_SITE_URL  (optional, default https://tnapplianceexchange.net/;
//                  use "sc-domain:tnapplianceexchange.net" for a domain property)
'use strict';
const { getSecretPreferVault } = require('./secrets');

const REDIRECT = 'https://tnapplianceexchange.net/.netlify/functions/gsc-oauth-callback';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';

async function creds() {
  const [clientId, clientSecret, refresh, site] = await Promise.all([
    getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'), getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET'),
    getSecretPreferVault('GSC_REFRESH_TOKEN'), getSecretPreferVault('GSC_SITE_URL'),
  ]);
  return { clientId, clientSecret, refresh, siteUrl: (site || 'https://tnapplianceexchange.net/').trim() };
}

async function accessToken(c) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.clientId, client_secret: c.clientSecret });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('token: ' + JSON.stringify(d).slice(0, 200));
  return d.access_token;
}

function ymd(d) { return d.toISOString().slice(0, 10); }

// searchAnalytics.query — the core read. dimensions e.g. ['query'] or ['query','page'].
// endDaysAgo shifts the window back (e.g. days=28, endDaysAgo=28 -> the 28 days
// BEFORE the last 28), so callers can compare period-over-period.
async function query({ days = 28, dimensions = ['query'], rowLimit = 250, endDaysAgo = 0 } = {}) {
  const c = await creds();
  if (!c.clientId || !c.clientSecret || !c.refresh) {
    return { ok: false, configured: false, missing: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GSC_REFRESH_TOKEN'].filter((k) => !({ GOOGLE_ADS_CLIENT_ID: c.clientId, GOOGLE_ADS_CLIENT_SECRET: c.clientSecret, GSC_REFRESH_TOKEN: c.refresh }[k])) };
  }
  const token = await accessToken(c);
  const end = new Date(Date.now() - (endDaysAgo || 0) * 86400000); const start = new Date(end.getTime() - days * 86400000);
  const url = `${API}/sites/${encodeURIComponent(c.siteUrl)}/searchAnalytics/query`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions, rowLimit }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, error: (d.error && (d.error.message || d.error.status)) || d, site: c.siteUrl };
  const rows = (d.rows || []).map((x) => ({
    keys: x.keys, clicks: x.clicks, impressions: x.impressions,
    ctr: Math.round((x.ctr || 0) * 1000) / 10, // %
    position: Math.round((x.position || 0) * 10) / 10,
  }));
  return { ok: true, site: c.siteUrl, days, rows };
}

module.exports = { creds, accessToken, query, REDIRECT, TOKEN_URL, SCOPE };
