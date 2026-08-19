// amazon-autoplace-cron — the trigger for the Amazon drop-ship auto-placer.
// A schedule-registered function edge-403s on direct HTTP, so the logic lives in the
// HTTP-callable `amazon-autoplace` core. This tiny wrapper is the only thing on the
// cron: every so often it invokes the core, which auto-ships any paid, ship-to-customer,
// Amazon parts order that carries an ASIN — but only for real once AMAZON_AUTOPLACE_LIVE=true
// AND the connector is in production; otherwise it just shadow-logs what it would place.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/amazon-autoplace?secret=${encodeURIComponent(admin)}`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String((e && e.message) || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, mode: out && out.mode, placed: out && out.placed, shadow: out && out.shadow, needs_asin: out && out.needs_asin, err }) };
};
