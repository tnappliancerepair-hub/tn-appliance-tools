// ai-scoreboard-cron — thin scheduled wrapper that fires the AI Scoreboard poll
// in-process weekly. Split from the background runner only so the schedule lives in
// netlify.toml; the runner does the real work (asks ChatGPT + Claude with live web
// search per market and writes AI_SCOREBOARD_STATE to the vault). Keeps a fresh
// weekly trend line even if nobody opens ai-scoreboard.html.
'use strict';
const run = require('./ai-scoreboard-run-background');

exports.handler = async function () {
  let res = { ok: false };
  try { res = await run.handler({ queryStringParameters: {} }); } catch (e) { res = { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) }; }
  return res && res.statusCode ? res : { statusCode: 200, body: JSON.stringify(res) };
};
