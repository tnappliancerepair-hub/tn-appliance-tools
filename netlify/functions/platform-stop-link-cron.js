// platform-stop-link-cron — thin scheduled wrapper for platform-stop-link.
//
// SPLIT ON PURPOSE. A Netlify function that carries its own `schedule` block edge-403s on
// EVERY external HTTP call, which would kill the ?secret= shadow run — the only way to
// eyeball what this would link BEFORE it writes to live job rows. Core stays curlable; this
// fires it in-process. Documented footgun, burned more than once.
//
// Hourly: a stop only becomes linkable once its second machine exists, and a stop that
// links an hour late costs nothing — but the office board's "🧩 N machines" flag and the
// tech's day count are both wrong until it does.
'use strict';

const { runStopLink } = require('./platform-stop-link');

exports.config = { timeout: 26 };
exports.handler = async function () {
  let res;
  try { res = await runStopLink({ apply: true, days: 45 }); }
  catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(res) };
};
