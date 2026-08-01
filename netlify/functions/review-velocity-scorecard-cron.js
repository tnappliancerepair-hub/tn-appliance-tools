// review-velocity-scorecard-cron — the weekly trigger for the review flywheel's
// scoreboard. A schedule-registered fn is 403 on direct HTTP, so the logic lives in
// the HTTP-callable `review-velocity-scorecard` core (pullable anytime with ?secret=).
// This tiny wrapper is the ONLY thing on the cron: once a week it invokes the core
// with text=1 so it computes the funnel, stores the trend snapshot, and texts Teddy
// where the hinge is leaking. Split = Teddy can pull "is the flywheel turning?" on
// demand AND get the weekly text. (Mirrors knowledge-scorecard-cron / phone-score.)
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/review-velocity-scorecard?secret=${encodeURIComponent(admin)}&text=1&days=7`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String(e && e.message || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, texted: !!(out && out.texted), review_count: out && out.review_count, leak: out && out.leak && out.leak.key, err }) };
};
