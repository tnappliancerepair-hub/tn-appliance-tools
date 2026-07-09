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

// Decode a Gmail payload to readable text — prefers text/plain, falls back to
// stripped text/html. Recurses through multipart bodies.
function decodeBody(payload) {
  if (!payload) return '';
  const b64 = (d) => { try { return Buffer.from(String(d || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } };
  const walk = (p, type) => {
    if (!p) return '';
    if (p.mimeType === type && p.body && p.body.data) return b64(p.body.data);
    for (const c of (p.parts || [])) { const r = walk(c, type); if (r) return r; }
    return '';
  };
  let txt = walk(payload, 'text/plain');
  if (!txt) { const html = walk(payload, 'text/html'); if (html) txt = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'); }
  if (!txt && payload.body && payload.body.data) txt = b64(payload.body.data);
  return txt.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Find the first message matching `query` across all inboxes and return its
// decoded body + headers. For reading one specific email in full.
async function readFirst(query, opts) {
  const o = opts || {};
  const accounts = await listAccounts();
  for (const acct of accounts) {
    try {
      const gmail = clientFor(acct);
      const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 1 });
      const msgs = (list.data && list.data.messages) || [];
      if (!msgs.length) continue;
      const fm = await gmail.users.messages.get({ userId: 'me', id: msgs[0].id, format: 'full' });
      const hs = (fm.data && fm.data.payload && fm.data.payload.headers) || [];
      const get = (n) => (hs.find((h) => h.name === n) || {}).value || '';
      let body = decodeBody(fm.data && fm.data.payload);
      if (o.maxChars) body = body.slice(0, o.maxChars);
      return { account: acct.label, id: msgs[0].id, date: get('Date'), from: get('From'), subject: get('Subject'), body };
    } catch (_) { /* try next inbox */ }
  }
  return null;
}

// Read the full decoded body of EVERY message matching `query` across all inboxes
// (up to max). For watchers that parse many emails (e.g. ServicePower parts notes).
async function readMany(query, opts) {
  const o = opts || {};
  const max = o.max || 30;
  const accounts = await listAccounts();
  const out = [];
  for (const acct of accounts) {
    try {
      const gmail = clientFor(acct);
      const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
      const msgs = (list.data && list.data.messages) || [];
      for (const m of msgs) {
        try {
          const fm = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
          const hs = (fm.data && fm.data.payload && fm.data.payload.headers) || [];
          const get = (n) => (hs.find((h) => h.name === n) || {}).value || '';
          out.push({ account: acct.label, id: m.id, thread: fm.data && fm.data.threadId, date: get('Date'), from: get('From'), subject: get('Subject'), body: decodeBody(fm.data && fm.data.payload) });
        } catch (_) {}
      }
    } catch (_) { /* skip inbox */ }
  }
  return out;
}

// Pull every URL out of the FIRST matching message — reading the raw HTML part so
// links inside <a href="..."> survive (decodeBody strips tags and loses the href).
// Used to recover a meeting/Zoom link a normal body read can't show.
async function readLinks(query) {
  const accounts = await listAccounts();
  const b64 = (d) => { try { return Buffer.from(String(d || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } };
  const rawWalk = (p) => {
    if (!p) return '';
    let s = '';
    if ((p.mimeType === 'text/html' || p.mimeType === 'text/plain') && p.body && p.body.data) s += b64(p.body.data) + '\n';
    for (const c of (p.parts || [])) s += rawWalk(c);
    if (!s && p.body && p.body.data) s += b64(p.body.data);
    return s;
  };
  for (const acct of accounts) {
    try {
      const gmail = clientFor(acct);
      const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 1 });
      const msgs = (list.data && list.data.messages) || [];
      if (!msgs.length) continue;
      const fm = await gmail.users.messages.get({ userId: 'me', id: msgs[0].id, format: 'full' });
      const hs = (fm.data && fm.data.payload && fm.data.payload.headers) || [];
      const get = (n) => (hs.find((h) => h.name === n) || {}).value || '';
      const raw = rawWalk(fm.data && fm.data.payload);
      const urls = Array.from(new Set((raw.match(/https?:\/\/[^\s"'<>)\]]+/g) || []).map((u) => u.replace(/&amp;/g, '&').replace(/[.,;]+$/, ''))));
      const meeting = urls.filter((u) => /zoom\.us|teams\.microsoft|meet\.google|webex|gotomeet|whereby|frontdoor.*meet/i.test(u));
      return { account: acct.label, id: msgs[0].id, date: get('Date'), from: get('From'), subject: get('Subject'), meeting, urls };
    } catch (_) { /* try next inbox */ }
  }
  return null;
}

module.exports = { listAccounts, clientFor, searchAll, readFirst, readMany, readLinks };
