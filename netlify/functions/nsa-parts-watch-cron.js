// nsa-parts-watch-cron — thin scheduled wrapper. The CORE (nsa-parts-watch) must stay
// free of a `schedule` block: a Netlify function that carries one edge-403s on EVERY
// external HTTP call, which kills the ?dryrun=1 shadow run — the only way to eyeball a
// vendor feed before it writes to job data. Documented footgun, burned twice already.
'use strict';
const { runNsaParts } = require('./nsa-parts-watch');

exports.config = { timeout: 26 };
exports.handler = async function () {
  let res;
  try { res = await runNsaParts({ dry: false, days: 45 }); }
  catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(res) };
};
