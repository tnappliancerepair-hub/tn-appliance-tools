// brain-autolearn-cron — the trigger for the automated knowledge flywheel. A schedule-
// registered function edge-403s on external HTTP (brain-autolearn calls get_job_for_dashboard),
// so the logic lives in the HTTP-callable core and this thin wrapper is the only thing on the
// cron: hourly it fires the core, which captures every newly-closed job's outcome into the
// brain and auto-fills any knowledge gap that job now answers.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let out = null, err = null;
  try {
    const r = await fetch(`${BASE}/brain-autolearn?secret=${encodeURIComponent(admin)}`, { signal: AbortSignal.timeout(24000) });
    out = await r.json();
  } catch (e) { err = String((e && e.message) || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, captured: out && out.captured, gaps_filled: out && out.gaps_filled, err }) };
};
