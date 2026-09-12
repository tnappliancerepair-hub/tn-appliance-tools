// ahs-returns-watch-cron — thin scheduled wrapper around ahs-returns-watch.
//
// The split is not cosmetic: a Netlify function that carries a `schedule` block EDGE-403s on
// every external HTTP call (empty body, fwd-status=403), so putting the cron on the core
// would kill the ?dryrun=1 shadow run -- the only way to eyeball an AHS return notice before
// it writes to job data. Same shape as platform-rma-tee / knowledge-scorecard.
'use strict';
const { runAhsReturns } = require('./ahs-returns-watch');

exports.config = { timeout: 26 };
exports.handler = async function () {
  let res;
  try { res = await runAhsReturns({ dry: false, days: 30 }); }
  catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(res) };
};
