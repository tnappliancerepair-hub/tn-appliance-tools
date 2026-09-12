// intake-collector-cron — thin scheduled wrapper for intake-collector.
//
// SPLIT ON PURPOSE. A Netlify function carrying its own `schedule` block edge-403s on every
// external HTTP call, which made intake-collector's `?dryrun=1` unreachable. That dry run is
// the only way to see WHO would be texted before anyone is, and this is the one agent that
// messages customers -- after the over-texting firefight, being unable to check first is the
// wrong trade. Core stays curlable (and now carries a real admin gate, which it never had);
// this fires it in-process on the schedule.
'use strict';

const { runIntakeCollector } = require('./intake-collector');

exports.config = { timeout: 26 };
exports.handler = async function () {
  try { return await runIntakeCollector({ scheduled: true }); }
  catch (e) {
    return { statusCode: 200, headers: { 'content-type': 'application/json' },
             body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
