// frontdoor-item-ids-cron — the hourly trigger for the STAR item-id capture.
//
// A schedule-registered function edge-403s on direct HTTP, and the whole point of this
// capture is being able to eyeball it (`?secret=&days=7` dry-run) before it writes. So the
// logic lives in the HTTP-callable `frontdoor-item-ids` core and this wrapper is the only
// thing on the cron. Keeps the one-time backfill (?days=90&max=200&apply=1) curlable too.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    // 3 days of overlap: a dispatch re-mails on update, and already_cached makes a re-read
    // a no-op, so the window is cheap insurance against a missed hour.
    const r = await fetch(`${BASE}/frontdoor-item-ids?secret=${encodeURIComponent(admin)}&days=3&max=40&apply=1`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String((e && e.message) || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err && !!(out && out.ok), counts: out && out.counts, err }) };
};
