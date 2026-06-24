// amazon-api-watch — watches the Gmail inbox for the Amazon Business / AWS
// Ordering-API approval email and TEXTS TEDDY the moment it lands, so he doesn't
// have to babysit his inbox waiting on API access. Scheduled in netlify.toml.
//
// Reuses the pollers' Gmail OAuth (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN). Dedups
// on alerted message IDs (event_log) so it texts once per email. ?dryrun=1 returns
// matches without texting (for testing).
'use strict';

const { google } = require('googleapis');
const { sendSms } = require('./_lib/sms');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const OWNER = '+16154855795';

// Amazon/AWS API-access-related mail in the last 14 days.
const QUERY = 'newer_than:14d (from:amazon.com OR from:amazonaws.com OR from:amazonsellerservices.com OR from:marketplace.amazonservices.com OR "amazon business" OR "aws") '
  + '(api OR "ordering api" OR "business api" OR "solution provider" OR "selling partner" OR "api access" OR developer OR credentials OR approved OR onboarding OR application)';

function hdr() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }

async function seenIds() {
  const h = hdr(); if (!h) return new Set();
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG}/content/search`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ search: { action: 'amazon_api_watch_seen' }, sort: { id: 'desc' }, per_page: 1, page: 1 }),
    });
    const j = await r.json().catch(() => ({}));
    let m = ((j.items || [])[0] || {}).metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return new Set((m && m.ids) || []);
  } catch (_) { return new Set(); }
}
async function recordSeen(ids) {
  const h = hdr(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'amazon_api_watch_seen', metadata: { ids: [...ids].slice(-50), at_ms: Date.now() } }) }); } catch (_) {}
}

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dryrun === '1';
  const clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET, refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return { statusCode: 200, body: 'no gmail creds' };

  let matches = [];
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const list = await gmail.users.messages.list({ userId: 'me', q: QUERY, maxResults: 12 });
    const msgs = (list.data && list.data.messages) || [];
    for (const m of msgs) {
      try {
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
        const hs = (full.data && full.data.payload && full.data.payload.headers) || [];
        const get = (n) => (hs.find((h) => h.name === n) || {}).value || '';
        matches.push({ id: m.id, subject: get('Subject'), from: get('From'), date: get('Date'), snippet: (full.data && full.data.snippet) || '' });
      } catch (_) {}
    }
  } catch (e) {
    return { statusCode: 200, body: 'gmail read failed: ' + String((e && e.message) || e) };
  }

  if (dry) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, count: matches.length, matches }, null, 2) };
  if (!matches.length) return { statusCode: 200, body: 'no amazon api mail' };

  const seen = await seenIds();
  const fresh = matches.filter((m) => !seen.has(m.id));
  if (!fresh.length) return { statusCode: 200, body: 'already alerted' };

  const top = fresh[0];
  const body = `[ant] 📬 Possible AMAZON/AWS API email just landed:\n\n"${(top.subject || '(no subject)').slice(0, 90)}"\nfrom ${(top.from || '').slice(0, 50)}\n\nCheck tnappliancerepair@gmail.com — if it's the Ordering-API access/creds, drop them in the vault and tell Ant to wire it.`;
  try { await sendSms(OWNER, body, 'owner', 'amazon_api_watch'); } catch (_) {}
  fresh.forEach((m) => seen.add(m.id));
  await recordSeen(seen);
  return { statusCode: 200, body: `alerted: ${fresh.length} new (subject: ${top.subject})` };
};
