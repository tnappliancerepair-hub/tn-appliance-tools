// platform-tn-mirror-cron — thin SCHEDULED wrapper. Every few minutes it re-runs the
// Xano->platform tenant mirror so TN's platform office board stays current with Xano
// during the crossover. Kept separate from the HTTP core (platform-tn-mirror) because
// Netlify scheduled functions edge-403 on manual HTTP — this way the core stays
// curl-testable. Schedule is set in netlify.toml.
'use strict';

const { syncTnToPlatform } = require('./platform-tn-mirror');

exports.handler = async function () {
  try {
    const out = await syncTnToPlatform(0);
    return { statusCode: 200, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
