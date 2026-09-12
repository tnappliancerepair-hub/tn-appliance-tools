// platform-tn-booking-back-cron — scheduled wrapper for platform-tn-booking-back.
// A function carrying its own `schedule` block edge-403s on manual HTTP, so the core stays
// curl-testable and this thin wrapper is the only scheduled surface. Every 5 minutes: a booking
// the office makes on the platform should be on the Xano board before the tech looks again.
'use strict';

const { runBookingBack } = require('./platform-tn-booking-back');

exports.config = { timeout: 26 };

exports.handler = async function () {
  let res = { ok: false };
  try {
    res = await runBookingBack({ max: '60' });
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }
  if (res && (res.pushed || (res.errors && res.errors.length))) {
    console.log('[booking-back] pushed=' + (res.pushed || 0) + ' errors=' + ((res.errors || []).length));
  }
  return { statusCode: 200, body: JSON.stringify(res) };
};
