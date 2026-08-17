// seo-scorecard-cron — the daily trigger for the SEO improvement engine. A
// schedule-registered function edge-403s on direct HTTP, so the logic lives in the
// HTTP-callable `seo-scorecard` core (pullable anytime with ?secret=&text=0). This
// tiny wrapper is the only thing on the cron: each morning it invokes the core with
// text=1 so it measures the machine, logs the trend + the day's lever, and texts the
// owner one thing to do. Split so Teddy can pull "how's the machine right now" on
// demand AND get the daily nudge.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/seo-scorecard?secret=${encodeURIComponent(admin)}&text=1`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String((e && e.message) || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, texted: !!(out && out.texted), err }) };
};
