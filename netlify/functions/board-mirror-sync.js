// board-mirror-sync — HTTP-callable CORE that refreshes the Supabase board_mirror.
// NON-scheduled on purpose (so it can be curled to test/verify/kick without hitting
// Netlify's scheduled-function edge-403). The scheduled runner is
// board-mirror-sync-cron, which just calls the same syncBoardMirror() logic.
//
//   ?secret=<VAPI_ADMIN_SECRET>          -> run a sync now, returns {synced, pruned, ms}
//   ?secret=<...>&dry=1                   -> pull only, report would_sync count (no write)
'use strict';

const { syncBoardMirror, fetchKanban } = require('./_lib/board-mirror');
const { getSecret } = require('./_lib/secrets');

const ADMIN_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || ADMIN_FALLBACK;
  if (q.secret !== admin) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
  }
  try {
    if (q.dry === '1') {
      const items = await fetchKanban();
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, dry: true, would_sync: items.length }) };
    }
    const out = await syncBoardMirror();
    return { statusCode: out.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
