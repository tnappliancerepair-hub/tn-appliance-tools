// embed-tdr-sweep-cron — scheduled kicker for the TDR→brain embedder.
//
// Split out because Netlify scheduled functions edge-403 on any external HTTP call,
// so the actual work lives in the non-scheduled, HTTP-testable background worker
// (embed-tdr-sweep-background). This thin wrapper just fires it on the schedule.
// Schedule is set in netlify.toml.
'use strict';
const { getSecret } = require('./_lib/secrets');
const SITE = 'https://tnapplianceexchange.net';

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  try {
    await fetch(`${SITE}/.netlify/functions/embed-tdr-sweep-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: admin, days: 4 }),
      signal: AbortSignal.timeout(8000),   // background returns 202 fast; we don't wait on the work
    });
  } catch (_) { /* background is fire-and-forget; the run logs itself to event_log */ }
  return { statusCode: 200, body: 'kicked' };
};
