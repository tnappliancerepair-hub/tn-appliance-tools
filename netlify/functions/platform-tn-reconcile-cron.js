// platform-tn-reconcile-cron — scheduled wrapper for platform-tn-reconcile.
// The mirror only ever ADDS and UPDATES: it fetches Xano's ACTIVE jobs and upserts them, so a
// job canceled in Xano simply stops appearing and the platform keeps its last-known state
// forever. The reconciler is what teaches the mirror that a job can LEAVE the active set — and
// it was built but never wired to a schedule, so it only ever ran when someone remembered.
// Every 15 minutes now: dead cards can't pile back up in the office's queue.
'use strict';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const GUARD = 'tn-vapi-admin-9f83b1c4e7a206d5';
  let out = { ok: false };
  try {
    const mod = require('./platform-tn-reconcile');
    const res = await mod.handler({ queryStringParameters: { secret: GUARD } });
    out = JSON.parse(res.body || '{}');
  } catch (e) {
    out = { ok: false, error: String((e && e.message) || e) };
  }
  if (out && out.canceled) console.log('[tn-reconcile] closed ' + out.canceled + ' canceled job(s)');
  return { statusCode: 200, body: JSON.stringify(out) };
};
