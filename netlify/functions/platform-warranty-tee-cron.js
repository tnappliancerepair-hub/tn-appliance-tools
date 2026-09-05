// platform-warranty-tee-cron — thin scheduled wrapper that fires the live warranty-email
// tee in-process. Split from the core because a scheduled Netlify fn edge-403s on manual
// HTTP (documented footgun) — the core stays curlable for a ?dryrun=1 check, and this
// cron self-fires the live run. Schedule lives in netlify.toml. Kill: PLATFORM_WARRANTY_TEE_ENABLED=false.
'use strict';
const { runTee } = require('./platform-warranty-tee');

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runTee(false); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
