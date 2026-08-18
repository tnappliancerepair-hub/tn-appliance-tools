// new-job-shop-email-cron — the trigger for the "new in-house job -> shop email" watcher.
// A schedule-registered function edge-403s on direct HTTP, so the logic lives in the
// HTTP-callable `new-job-shop-email` core. This tiny wrapper is the only thing on the
// cron: every few minutes it invokes the core, which emails the shop about any new
// in-house (cash / self-pay) job Danielle hasn't been told about yet.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/new-job-shop-email?secret=${encodeURIComponent(admin)}`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String((e && e.message) || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, sent: out && out.sent, err }) };
};
