// platform-tn-parts-migrate-cron — thin scheduled wrapper that fires the FORWARD parts
// migration in-process (copies recent parts_orders + warranty-part events from Xano onto the
// platform job_part). Split from the core because a scheduled Netlify fn edge-403s on manual
// HTTP (documented footgun) — the core stays curlable for ?dryrun=1 / backfill, and this cron
// self-fires the live forward run. Schedule lives in netlify.toml. Kill: PLATFORM_PARTS_MIGRATE_ENABLED=false.
'use strict';
const { runMigrate } = require('./platform-tn-parts-migrate');

exports.config = { timeout: 26 };

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runMigrate({ dry: false, mode: 'forward' }); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
