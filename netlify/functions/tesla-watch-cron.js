// tesla-watch-cron — the trigger for the durable Tesla watch. A schedule-registered
// function edge-403s on direct external HTTP (it fetches Google News RSS), so the logic
// lives in the HTTP-callable `tesla-watch` core and this thin wrapper is the only thing on
// the cron: twice a week it invokes the core, which texts Teddy only if a genuine new
// development shows up on either trigger (consumer Cybercab ordering / Nashville robotaxi).
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/tesla-watch?secret=${encodeURIComponent(admin)}`, { signal: AbortSignal.timeout(24000) });
    out = await r.text();
  } catch (e) { err = String((e && e.message) || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, result: out, err }) };
};
