// platform-tn-job-back-cron — scheduled wrapper for platform-tn-job-back.
// A function carrying its own `schedule` block edge-403s on manual HTTP, so the core stays
// curl-testable and this thin wrapper is the only scheduled surface.
'use strict';

const { runJobBack } = require('./platform-tn-job-back');

exports.config = { timeout: 26 };

exports.handler = async function () {
  let res = { ok: false };
  try {
    res = await runJobBack({ max: '10' });
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }
  if (res && (res.created || res.linked || (res.errors && res.errors.length))) {
    console.log('[job-back] created=' + (res.created || 0) + ' linked=' + (res.linked || 0) + ' errors=' + ((res.errors || []).length));
  }
  return { statusCode: 200, body: JSON.stringify(res) };
};
