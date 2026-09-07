// platform-referral-cron — daily backstop that recomputes every bill-credit referrer's $25/mo
// Stripe coupon (the "Ant Army"). The Stripe webhook already recomputes a referrer the instant a
// referred shop pays/churns; this sweep catches anything the webhook missed. Split from the core
// because a function with its own `schedule` block edge-403s on manual HTTP — platform-referral
// (do=apply) stays curlable for dry-runs. Writes NOTHING until PLATFORM_REFERRAL_CREDIT_LIVE=1
// (applyAll enforces the gate); otherwise it shadow-computes.
'use strict';
const { applyAll } = require('./platform-referral');
exports.config = { timeout: 26 };
exports.handler = async function () {
  try { const r = await applyAll({}); console.log('[referral-cron]', JSON.stringify(r)); }
  catch (e) { console.log('[referral-cron] error', String((e && e.message) || e)); }
  return { statusCode: 200, body: 'ok' };
};
