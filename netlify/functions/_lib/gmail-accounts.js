// gmail-accounts — one place that knows EVERY connected Gmail inbox, so the
// search tool + the API watchers can scan more than one account.
//
//   Account 1 = GMAIL_*        (tnappliancerepair@gmail.com — env, original)
//   Account 2 = GMAIL2_*       (tnappliance@gmail.com — vault, added via
//                               gmail2-oauth-start). Reuses account 1's OAuth
//                               client unless its own GMAIL2_CLIENT_ID is set.
//
// Adding a 3rd inbox later = vault GMAIL3_REFRESH_TOKEN + extend listAccounts.
'use strict';
const { google } = require('googleapis');
const { getSecretPreferVault } = require('./secrets');

// Friendly labels for known extra-inbox slots (cosmetic; shown on match tags).
// New slots default to 'inbox-<n>' until a GMAIL{n}_ACCOUNT_LABEL is set.
const EXTRA_LABELS = { 2: 'tnappliance@gmail.com' };

// Returns [{ label, clientId, clientSecret, refreshToken }] for every inbox we
// have a working token for. Missing accounts are simply omitted (never throws).
async function listAccounts() {
  const out = [];

  const id1 = await getSecretPreferVault('GMAIL_CLIENT_ID');
  const sec1 = await getSecretPreferVault('GMAIL_CLIENT_SECRET');
  const rt1 = await getSecretPreferVault('GMAIL_REFRESH_TOKEN');
  if (id1 && sec1 && rt1) {
    out.push({ label: process.env.GMAIL_ACCOUNT_LABEL || 'tnappliancerepair@gmail.com', clientId: id1, clientSecret: sec1, refreshToken: rt1 });
  }

  // Extra inboxes (slots 2..5) are all minted via the "Ant Ads" WEB OAuth client
  // (GOOGLE_ADS_*) — a Web client can hold the https redirect URI the connect
  // flow needs (the Gmail "AHS Poller" client is Desktop-type and can't). A
  // refresh token must be read back with the SAME client that minted it, so each
  // slot pairs its GMAIL{n}_REFRESH_TOKEN with the Ads client id/secret. Adding
  // an inbox = hit gmail2-oauth-start?n=<n> signed in as that account; no extra
  // console step (same client, same already-registered redirect).
  const adsId = await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID');
  const adsSec = await getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET');
  for (let n = 2; n <= 5; n++) {
    const rt = await getSecretPreferVault('GMAIL' + n + '_REFRESH_TOKEN');
    if (!rt) continue;
    const id = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_ID')) || adsId;
    const sec = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_SECRET')) || adsSec;
    if (!id || !sec) continue;
    const label = (await getSecretPreferVault('GMAIL' + n + '_ACCOUNT_LABEL')) || EXTRA_LABELS[n] || ('inbox-' + n);
    out.push({ label, clientId: id, clientSecret: sec, refreshToken: rt });
  }

  return out;
}

function clientFor(acct) {
  const oauth2 = new google.auth.OAuth2(acct.clientId, acct.clientSecret);
  oauth2.setCredentials({ refresh_token: acct.refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

// Run one Gmail query across EVERY connected inbox; merge the hits. Each match
// is tagged with .account so the caller knows which inbox it came from. One bad
// account (expired token, etc.) is skipped without killing the others.
//   opts.max     — per-account message cap (default 20)
//   opts.headers — which metadata headers to pull (default Subject/From/Date)
async function searchAll(query, opts) {
  const o = opts || {};
  const max = o.max || 20;
  const headers = o.headers || ['Subject', 'From', 'Date'];
  const accounts = await listAccounts();
  const matches = [];
  for (const acct of accounts) {
    try {
      const gmail = clientFor(acct);
      const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
      const msgs = (list.data && list.data.messages) || [];
      for (const m of msgs) {
        try {
          const fm = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: headers });
          const hs = (fm.data && fm.data.payload && fm.data.payload.headers) || [];
          const get = (n) => (hs.find((h) => h.name === n) || {}).value || '';
          const row = { account: acct.label, id: m.id, thread: fm.data && fm.data.threadId, date: get('Date'), from: get('From'), subject: get('Subject'), snippet: (fm.data && fm.data.snippet) || '' };
          if (headers.includes('To')) row.to = get('To');
          if (headers.includes('Cc')) row.cc = get('Cc');
          matches.push(row);
        } catch (_) {}
      }
    } catch (_) { /* skip this inbox, keep the rest */ }
  }
  return { accounts: accounts.map((a) => a.label), matches };
}

module.exports = { listAccounts, clientFor, searchAll };
