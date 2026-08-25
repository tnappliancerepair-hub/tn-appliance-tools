// board-mirror-sync-cron — thin SCHEDULED wrapper. Fires every minute and calls
// the same syncBoardMirror() the HTTP core uses, keeping board_mirror fresh so the
// office board serves from Supabase (fast) instead of Xano (slow). Kept separate
// from the HTTP core because Netlify scheduled functions edge-403 on manual HTTP;
// this way the core stays curl-testable. Schedule is set in netlify.toml.
'use strict';

const { syncBoardMirror } = require('./_lib/board-mirror');

exports.handler = async function () {
  try {
    const out = await syncBoardMirror();
    return { statusCode: 200, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
