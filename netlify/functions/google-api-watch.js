// google-api-watch — watches the Gmail inbox for the Google API approval emails
// (Business Profile API access — support case 4-9470000004382 — and the Google Ads
// API Basic Access approval) and TEXTS TEDDY the moment one lands, so he doesn't
// have to babysit his inbox waiting on the allowlist. Scheduled in netlify.toml.
//
// Reuses the pollers' Gmail OAuth (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN). Dedups on
// alerted message IDs (event_log) so it texts once per email. ?dryrun=1 returns
// matches without texting (for testing).
'use strict';

const { sendSms } = require('./_lib/sms');
const { searchAll } = require('./_lib/gmail-accounts');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const OWNER = '+16154855795';

// Google API-access mail in the last 30 days: the Business Profile API allowlist
// decision (often references the support case # 4-9470000004382), or the Google Ads
// API Basic Access decision (developer token). Sender is usually a google.com address.
const QUERY = 'newer_than:30d (from:google.com OR from:googleapis.com OR from:googleadsapi-noreply@google.com OR "business profile" OR "google ads api") '
  + '("business profile api" OR "api access" OR "basic access" OR "developer token" OR allowlist OR allowlisted OR approved OR "access request" OR "4-9470000004382" OR "your request")';

function hdr() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }

async function seenIds() {
  const h = hdr(); if (!h) return new Set();
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG}/content/search`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ search: { action: 'google_api_watch_seen' }, sort: { id: 'desc' }, per_page: 1, page: 1 }),
    });
    const j = await r.json().catch(() => ({}));
    let m = ((j.items || [])[0] || {}).metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return new Set((m && m.ids) || []);
  } catch (_) { return new Set(); }
}
async function recordSeen(ids) {
  const h = hdr(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'google_api_watch_seen', metadata: { ids: [...ids].slice(-50), at_ms: Date.now() } }) }); } catch (_) {}
}

// Guess which key the email is about, for a more useful text.
function classify(m) {
  const s = `${m.subject || ''} ${m.snippet || ''}`.toLowerCase();
  if (/business profile|4-9470000004382|my business/.test(s)) return 'Business Profile API (reviews)';
  if (/google ads api|developer token|basic access/.test(s)) return 'Google Ads API';
  return 'a Google API request';
}

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dryrun === '1';

  let matches = [];
  try {
    const res = await searchAll(QUERY, { max: 12 });
    if (!res.accounts.length) return { statusCode: 200, body: 'no connected gmail accounts' };
    matches = res.matches;
  } catch (e) {
    return { statusCode: 200, body: 'gmail read failed: ' + String((e && e.message) || e) };
  }

  if (dry) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, count: matches.length, matches }, null, 2) };
  if (!matches.length) return { statusCode: 200, body: 'no google api mail' };

  const seen = await seenIds();
  const fresh = matches.filter((m) => !seen.has(m.id));
  if (!fresh.length) return { statusCode: 200, body: 'already alerted' };

  const top = fresh[0];
  const which = classify(top);
  const body = `[ant] 📬 Possible GOOGLE API email just landed — likely ${which}:\n\n"${(top.subject || '(no subject)').slice(0, 90)}"\nfrom ${(top.from || '').slice(0, 50)}\n\nCheck ${top.account || 'your inbox'} — if it's the access approval, drop the OAuth creds in the vault and tell Ant to wire it.`;
  try { await sendSms(OWNER, body, 'owner', 'google_api_watch'); } catch (_) {}
  fresh.forEach((m) => seen.add(m.id));
  await recordSeen(seen);
  return { statusCode: 200, body: `alerted: ${fresh.length} new (subject: ${top.subject})` };
};
