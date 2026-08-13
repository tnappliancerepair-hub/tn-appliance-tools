// telnyx-call-review-cron — nightly trigger for Ann's self-teaching flywheel. A
// schedule-registered function 403s on direct HTTP, so the review logic lives in the
// HTTP-callable `telnyx-call-review` core (pullable anytime with ?secret=&text=0). This
// thin wrapper is the only thing on the cron: ~8:30PM CT it fires the core with text=1 so
// it reads the day's calls, grades them, stores the trend + gaps, and texts Teddy the top
// fixes. Split so Teddy can pull "how's she doing right now" on demand AND get the nightly.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/telnyx-call-review?secret=${encodeURIComponent(admin)}&hours=24&text=1`, { signal: AbortSignal.timeout(25000) });
    out = await r.json();
  } catch (e) { err = String((e && e.message) || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, reviewed: out && out.reviewed, texted: !!(out && out.texted), err }) };
};
