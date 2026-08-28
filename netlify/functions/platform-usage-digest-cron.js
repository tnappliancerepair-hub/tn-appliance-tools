// platform-usage-digest-cron — thin SCHEDULED wrapper. Netlify edge-403s a function that
// has its own schedule block on manual HTTP, so the digest LOGIC lives in the HTTP-callable
// core (platform-usage-digest) and this cron just fires it live once daily. Runs the core
// in-process with next_run=true so it self-authorizes and does the real (non-dry) run.
'use strict';
const core = require('./platform-usage-digest');

exports.handler = async function () {
  try {
    const res = await core.handler({ httpMethod: 'POST', queryStringParameters: {}, body: JSON.stringify({ next_run: true }) });
    let n = 0; try { n = (JSON.parse(res.body || '{}').results || []).filter((r) => !r.skipped).length; } catch (_) {}
    console.log('[usage-digest-cron] fired — owners emailed:', n);
  } catch (e) { console.log('[usage-digest-cron] error', String((e && e.message) || e)); }
  return { statusCode: 200, body: 'ok' };
};
