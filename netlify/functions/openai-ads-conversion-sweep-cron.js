// openai-ads-conversion-sweep-cron — thin scheduled wrapper that fires the live
// OpenAI Ads conversion sweep in-process. Split from the core because a scheduled
// Netlify fn edge-403s on manual HTTP (documented footgun) — the core stays
// curlable for a ?dryrun=1 check, and this cron self-fires the live run.
// Schedule lives in netlify.toml.
'use strict';
const { runSweep } = require('./openai-ads-conversion-sweep');

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runSweep(false); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
