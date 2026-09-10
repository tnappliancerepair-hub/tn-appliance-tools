// platform-tn-status-back-cron — scheduled wrapper for platform-tn-status-back.
// A function carrying its own `schedule` block edge-403s on manual HTTP, so the core stays
// curl-testable and this thin wrapper is the only scheduled surface.
'use strict';

const { runStatusBack } = require('./platform-tn-status-back');

exports.config = { timeout: 26 };

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runStatusBack({ max: '25' }); }
  catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  if (res && (res.pushed || (res.errors && res.errors.length))) {
    console.log('[status-back] pushed=' + (res.pushed || 0) + ' errors=' + ((res.errors || []).length));
  }
  return { statusCode: 200, body: JSON.stringify(res) };
};
