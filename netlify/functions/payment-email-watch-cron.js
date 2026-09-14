// payment-email-watch-cron — the scheduled trigger for the payment receipt email.
//
// Split from the core on purpose. A Netlify function carrying a `schedule` block edge-403s
// on every external HTTP call, which meant the core's own ?dry=1 -- the only way to eyeball
// which payments are about to be emailed -- was unreachable for the life of the feature.
// On a money path that is the wrong trade. The logic now lives in the HTTP-callable
// `payment-email-watch` core (pullable anytime with ?secret=&dry=1) and this wrapper is the
// only thing on the cron.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/payment-email-watch?secret=${encodeURIComponent(admin)}`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String(e && e.message || e); }
  return {
    statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: !err, new: out && out.new, summary: out && out.summary, platform_read_error: out && out.platform_read_error, err }),
  };
};
