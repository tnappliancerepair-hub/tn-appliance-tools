// platform-tn-report-tee-cron — thin scheduled wrapper that fires the FORWARD report tee
// in-process (newest technician reports from Xano into the platform job_tdr table, plus recent
// office notes onto job.office_notes). Split from the core because a scheduled Netlify fn
// edge-403s on manual HTTP (documented footgun) - the core stays curlable for ?dryrun=1 and
// the backfill walk, and this cron self-fires the live forward run. Schedule lives in
// netlify.toml. Kill: vault PLATFORM_REPORT_TEE_ENABLED=false.
'use strict';
const { runTee } = require('./platform-tn-report-tee');

exports.config = { timeout: 26 };

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runTee({ dry: false, backfill: false }); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
