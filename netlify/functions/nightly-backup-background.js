// nightly-backup-background — the heavy worker (Netlify background fn, ~15 min).
// Mirrors all money-critical Xano tables (incl. event_log) into Supabase.
// Triggered by the scheduled nightly-backup trigger (or manually with the admin
// secret). Returns 202 immediately to the caller; the body is for function logs.
//
//   GET /.netlify/functions/nightly-backup-background?secret=<admin>
'use strict';

const { getSecret } = require('./_lib/secrets');
const { backupTables } = require('./_lib/backup');
const { backupPlatform } = require('./_lib/platform-backup');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.handler = async function (event) {
  const secret = ((event.queryStringParameters || {}).secret) || '';
  let admin = '';
  try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  const q = event.queryStringParameters || {};
  // ?platform=1 runs ONLY the platform snapshot (seconds) -- used to seed the
  // first manifest and to re-run it without touching the Xano side.
  if (q.platform) {
    try { return { statusCode: 200, body: JSON.stringify({ ok: true, platform: await backupPlatform({}) }) }; }
    catch (e) { return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) }; }
  }
  const clearFirst = !!q.clear;
  const eventLogPages = q.elpages ? parseInt(q.elpages, 10) : undefined;
  const only = q.only ? String(q.only).split(',').map((n) => parseInt(n, 10)).filter(Boolean) : undefined;
  try {
    const summary = await backupTables({ writeAudit: true, clearFirst, eventLogPages, only });
    // Second source: the ANT Platforms project itself. TN's live operation now
    // lives there and nothing was copying it anywhere. ~25k rows / seconds.
    // Isolated -- a platform failure must never cost us the Xano backup.
    let platform = null;
    if (!only) {
      try { platform = await backupPlatform({}); }
      catch (e) { platform = { ok: false, error: String((e && e.message) || e).slice(0, 200) }; }
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, summary, platform }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
