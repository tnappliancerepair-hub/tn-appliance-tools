// platform-rma-tee-cron — thin scheduled wrapper that fires the live RMA-label tee
// in-process. Split from the core because a scheduled Netlify fn edge-403s on manual
// HTTP (documented footgun) — the core stays curlable for a ?dryrun=1 check, and this
// cron self-fires the live run. Schedule lives in netlify.toml. Kill: PLATFORM_RMA_TEE_ENABLED=false.
'use strict';
const { runRma } = require('./platform-rma-tee');

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runRma(false); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
