// platform-tn-parts-migrate-cron — thin scheduled wrapper that fires the forward
// run of the phase-2 parts migration in-process (a scheduled Netlify fn edge-403s
// on manual HTTP, so the core stays curlable + the cron self-fires the live run).
// Schedule in netlify.toml (offset from the mirror + intake/warranty tees).
'use strict';

const { runPartsMigrate } = require('./platform-tn-parts-migrate');
const { getSecretFresh } = require('./_lib/secrets');

exports.config = { timeout: 26 };

exports.handler = async function () {
  try {
    const enabled = String((await getSecretFresh('PLATFORM_PARTS_MIGRATE_ENABLED')) || '').toLowerCase();
    if (enabled === 'false') return { statusCode: 200, body: 'disabled' };
    const res = await runPartsMigrate({ dry: false, mode: 'forward' });
    return { statusCode: 200, body: JSON.stringify(res) };
  } catch (err) {
    return { statusCode: 200, body: 'err:' + String(err && err.message || err) };
  }
};
