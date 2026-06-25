// gmail-search — owner-gated admin tool to search the Gmail inbox with an arbitrary
// query and see matching emails (Subject/From/To/Date/snippet). Built to FIND a past
// thread — e.g. "where/who did we email about Amazon Business API access?" — without
// having to dig through the inbox by hand. Reuses the pollers' Gmail OAuth.
//
//   GET ?secret=<admin>&q=<gmail query>[&max=20][&full=1]
//   q defaults to an Amazon-Business-API correspondence search.
//   &full=1 also pulls the To/Cc headers + a longer snippet.
'use strict';
const { google } = require('googleapis');
const { getSecret } = require('./_lib/secrets');

const DEFAULT_Q = '("amazon business" OR amazon.com OR amazonaws.com OR amazonservices.com) '
  + '(api OR "ordering api" OR "business api" OR "selling partner" OR "solution provider" '
  + 'OR developer OR credentials OR application OR "api access" OR onboarding OR integration) '
  + 'newer_than:400d';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q0 = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q0.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const query = String(q0.q || DEFAULT_Q);
  const max = Math.min(parseInt(q0.max, 10) || 20, 50);
  const full = q0.full === '1';

  const clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET, refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return json(200, { ok: false, error: 'no gmail creds in env' });

  let matches = [];
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
    const msgs = (list.data && list.data.messages) || [];
    const want = full ? ['Subject', 'From', 'To', 'Cc', 'Date'] : ['Subject', 'From', 'Date'];
    for (const m of msgs) {
      try {
        const fm = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: want });
        const hs = (fm.data && fm.data.payload && fm.data.payload.headers) || [];
        const get = (n) => (hs.find((h) => h.name === n) || {}).value || '';
        const row = { id: m.id, thread: fm.data.threadId, date: get('Date'), from: get('From'), subject: get('Subject'), snippet: (fm.data && fm.data.snippet) || '' };
        if (full) { row.to = get('To'); row.cc = get('Cc'); }
        matches.push(row);
      } catch (_) {}
    }
  } catch (e) {
    return json(200, { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) });
  }

  return json(200, { ok: true, query, count: matches.length, matches });
};
