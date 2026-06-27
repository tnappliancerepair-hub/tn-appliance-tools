// nightly-backup-background — the heavy worker (Netlify background fn, ~15 min).
// Mirrors all money-critical Xano tables (incl. event_log) into Supabase.
// Triggered by the scheduled nightly-backup trigger (or manually with the admin
// secret). Returns 202 immediately to the caller; the body is for function logs.
//
//   GET /.netlify/functions/nightly-backup-background?secret=<admin>
'use strict';

const { getSecret } = require('./_lib/secrets');
const { backupTables } = require('./_lib/backup');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.handler = async function (event) {
  const secret = ((event.queryStringParameters || {}).secret) || '';
  let admin = '';
  try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  const clearFirst = !!((event.queryStringParameters || {}).clear);
  try {
    const summary = await backupTables({ writeAudit: true, clearFirst });
    return { statusCode: 200, body: JSON.stringify({ ok: true, summary }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
