// servicepower-auto-accept-cron — thin scheduled wrapper that fires the live accept +
// API-native intake in-process. Split from the core because a scheduled Netlify fn
// edge-403s on manual HTTP (documented footgun) — the core stays curlable for the
// ?dryrun=1 shadow check, and this cron self-fires the real run. Schedule lives in
// netlify.toml. Kill: vault SERVICEPOWER_AUTO_ACCEPT=false / SERVICEPOWER_API_INTAKE=false.
'use strict';
const { runAutoAccept } = require('./servicepower-auto-accept');

exports.handler = async function () {
  let res = { ok: false };
  // A scheduled invocation gets the 15-min allowance, so the budget can be far wider than
  // the 26s the HTTP core is capped at — the board pull is the slow part.
  try { res = await runAutoAccept({ dry: false, budgetMs: 120000 }); }
  catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
