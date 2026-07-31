// knowledge-scorecard-cron — the nightly trigger for the Knowledge Engine's
// scoreboard (goal: the most advanced troubleshooting brain in appliance repair).
// A schedule-registered function is 403 on direct HTTP, so the scoreboard logic
// lives in the HTTP-callable `knowledge-scorecard` core (pullable anytime with
// ?secret=&text=0). This tiny wrapper is the ONLY thing on the cron: ~7:10PM CT
// it invokes the core with text=1 so it computes, stores the trend, and texts the
// owner. Keeping them split means Teddy can pull "how smart are we right now" on
// demand AND get the nightly text.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/knowledge-scorecard?secret=${encodeURIComponent(admin)}&text=1&days=7`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String(e && e.message || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, texted: !!(out && out.texted), score: out && out.score, err }) };
};
