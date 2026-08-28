// platform-usage-bill-cron — thin SCHEDULED wrapper. Netlify edge-403s a function with its own
// schedule block on manual HTTP, so the metered-billing LOGIC lives in the HTTP-callable core
// (platform-usage-bill) and this cron just fires it once a week (Monday) with next_run=true so it
// self-authorizes and reports last week's Ann overage to Stripe (live only when PLATFORM_BILLING_LIVE=true).
'use strict';
const core = require('./platform-usage-bill');

exports.handler = async function () {
  try {
    const res = await core.handler({ httpMethod: 'POST', queryStringParameters: {}, body: JSON.stringify({ next_run: true }) });
    let n = 0, live = false; try { const p = JSON.parse(res.body || '{}'); n = p.billed || 0; live = !!p.live; } catch (_) {}
    console.log('[usage-bill-cron] fired — live:', live, 'tenants billed:', n);
  } catch (e) { console.log('[usage-bill-cron] error', String((e && e.message) || e)); }
  return { statusCode: 200, body: 'ok' };
};
