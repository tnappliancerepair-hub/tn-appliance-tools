// servicepower-auto-accept-cron — thin scheduled wrapper that fires the live accept +
// API-native intake in-process. Split from the core because a scheduled Netlify fn
// edge-403s on manual HTTP (documented footgun) — the core stays curlable for the
// ?dryrun=1 shadow check, and this cron self-fires the real run. Schedule lives in
// netlify.toml. Kill: vault SERVICEPOWER_AUTO_ACCEPT=false / SERVICEPOWER_API_INTAKE=false.
'use strict';
const { runAutoAccept } = require('./servicepower-auto-accept');

// TWO CADENCES over one board pull, because the two passes want different windows:
//
//   accept  — a new OPEN offer is always fresh, so 6 days is plenty.
//   intake  — the job it RECOVERS is by definition one nothing else caught, and those are
//             old by the time they surface. The first live run found KATHRYN CARAWAY, whose
//             dispatch was created 8 days earlier (scheduled + accepted, invisible on both
//             boards) — a 6-day window would never have seen her.
//
// So the tick at :04 sweeps 21 days and the other five stay shallow. One deep pull an hour
// instead of six: the recovery window is wide, ServicePower's SOAP endpoint isn't hammered,
// and a re-scan of an already-landed call costs one indexed lookup (createWarrantyJob dedupes).
const DEEP_DAYS = 21;
const SHALLOW_DAYS = 6;

exports.handler = async function () {
  const deep = new Date().getUTCMinutes() < 14;   // schedule is 4-59/10 → only :04 qualifies
  let res = { ok: false };
  // A scheduled invocation gets the 15-min allowance, so the budget can be far wider than
  // the 26s the HTTP core is capped at — the board pull is the slow part.
  try { res = await runAutoAccept({ dry: false, days: deep ? DEEP_DAYS : SHALLOW_DAYS, budgetMs: deep ? 300000 : 120000 }); }
  catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify({ sweep: deep ? 'deep' : 'shallow', ...res }) };
};
