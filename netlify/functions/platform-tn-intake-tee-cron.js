// platform-tn-intake-tee-cron — thin scheduled wrapper that fires the FORWARD intake tee
// in-process (copies recent video/photos/waivers from Xano onto the platform). Split from
// the core because a scheduled Netlify fn edge-403s on manual HTTP (documented footgun) —
// the core stays curlable for ?dryrun=1 / backfill, and this cron self-fires the live
// forward run. Schedule lives in netlify.toml. Kill: PLATFORM_INTAKE_TEE_ENABLED=false.
'use strict';
const { runTee } = require('./platform-tn-intake-tee');

exports.config = { timeout: 26 };

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runTee({ dry: false, mode: 'forward' }); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
