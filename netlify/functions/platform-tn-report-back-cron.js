// platform-tn-report-back-cron — thin scheduled wrapper that fires the REVERSE report tee
// in-process: a technician report filed on the PLATFORM goes back into Xano, blank fields only.
// Split from the core because a scheduled Netlify fn edge-403s on manual HTTP (documented
// footgun) - the core stays curlable for ?dryrun=1 and this cron self-fires the live run.
// This is the money path: servicepower-claims-build reads Xano, so a report that never gets
// back there is a warranty claim nobody can file. Schedule lives in netlify.toml.
// Kill: vault PLATFORM_REPORT_BACK_ENABLED=false.
'use strict';
const { runBack } = require('./platform-tn-report-back');

exports.config = { timeout: 26 };

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runBack({ max: '60' }); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
