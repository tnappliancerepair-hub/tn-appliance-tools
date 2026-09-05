// platform-review-sweep-cron — thin scheduled wrapper around platform-review-sweep's runSweep.
// Split out because a Netlify function carrying its own `schedule` block edge-403s on manual
// HTTP (documented footgun) — so the core (platform-review-sweep.js) stays curlable for
// testing/dry-runs, and this wrapper is the one the cron fires. Sends only when
// PLATFORM_REVIEW_SWEEP_LIVE=1 (runSweep enforces the LIVE gate); otherwise shadow-logs.
'use strict';
const { runSweep } = require('./platform-review-sweep');
exports.config = { timeout: 26 };
exports.handler = async function () {
  try { const r = await runSweep({}); console.log('[review-sweep-cron]', JSON.stringify(r)); }
  catch (e) { console.log('[review-sweep-cron] error', String((e && e.message) || e)); }
  return { statusCode: 200, body: 'ok' };
};
