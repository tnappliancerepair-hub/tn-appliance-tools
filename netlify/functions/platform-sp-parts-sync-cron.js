// platform-sp-parts-sync-cron — thin scheduled wrapper that fires the parts sync in-process.
// Split from the core because a scheduled Netlify fn edge-403s on manual HTTP (documented
// footgun) — the core stays curlable for a ?dry=1 shadow check, and this cron self-fires the
// live run. Schedule lives in netlify.toml.
'use strict';
const { runSync } = require('./platform-sp-parts-sync');

exports.handler = async function () {
  let res = { ok: false };
  try { res = await runSync({ limit: '12' }); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  return { statusCode: 200, body: JSON.stringify(res) };
};
