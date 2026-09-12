// platform-intake-split-watch-cron — thin scheduled wrapper.
//
// SPLIT ON PURPOSE: a function carrying its own `schedule` block edge-403s on every external
// HTTP call, which would kill the ?secret= shadow run — the only way to see what it would
// flag before it writes. Core stays curlable; this fires it in-process.
//
// Every 4h is plenty: the flag is read by the tech when he opens the job, and a dispatch that
// gets flagged a few hours after it lands still beats the tech to the door.
'use strict';

const { runIntakeSplit } = require('./platform-intake-split-watch');

exports.config = { timeout: 26 };
exports.handler = async function () {
  let res;
  try { res = await runIntakeSplit({ apply: true, days: 21 }); }
  catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(res) };
};
