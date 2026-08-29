// platform-appt-reminder-cron — thin SCHEDULED wrapper. Netlify edge-403s a function with its
// own schedule block on manual HTTP, so the logic lives in the HTTP-callable core
// (platform-appt-reminder) and this cron fires it live once each morning (self-authorizes via next_run).
'use strict';
const core = require('./platform-appt-reminder');

exports.handler = async function () {
  try {
    const res = await core.handler({ httpMethod: 'POST', queryStringParameters: {}, body: JSON.stringify({ next_run: true }) });
    let n = 0; try { n = JSON.parse(res.body || '{}').sent || 0; } catch (_) {}
    console.log('[appt-reminder-cron] fired — reminders sent:', n);
  } catch (e) { console.log('[appt-reminder-cron] error', String((e && e.message) || e)); }
  return { statusCode: 200, body: 'ok' };
};
