// new-lead-alert-cron — the scheduled half of new-lead-alert.
//
// SPLIT ON PURPOSE: a Netlify function that carries its own `schedule` block edge-403s
// on every external HTTP call, so the core would lose its ?dry=1 shadow run -- the only
// way to eyeball who is about to be texted before it happens. Core stays curlable, this
// thin wrapper fires it. Same shape as lsa-lead-watch / knowledge-scorecard.
'use strict';
const core = require('./new-lead-alert');

exports.handler = async function () {
  try {
    const r = await core.run({});
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
