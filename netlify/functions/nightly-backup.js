// nightly-backup — scheduled trigger (3:00am CT) + manual controls.
//   - cron (no params)            -> fires the background worker (full backup)
//   - ?secret=<admin>            -> manual full run (fires the background worker)
//   - ?probe=1&secret=<admin>    -> SMALL synchronous backup (technicians only),
//                                    returns the result so we can verify the whole
//                                    Xano->Supabase chain live without waiting.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { backupTables } = require('./_lib/backup');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let admin = '';
  try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;

  // Status: read the latest snapshot's manifest from Supabase (verify it ran + counts).
  if (q.status && q.secret === admin) {
    try {
      const rows = await sb.select('xano_backup_chunks', { table_name: 'eq._manifest', order: 'created_at.desc', limit: '1', select: 'snapshot_date,created_at,rows' });
      return { statusCode: 200, body: JSON.stringify({ ok: true, latest: (rows && rows[0]) || null }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
    }
  }

  // Live verify: synchronous backup of specific tables (default technicians).
  // ?probe=1&only=6,47 to test specific table ids and see counts/errors inline.
  if (q.probe && q.secret === admin) {
    try {
      const only = q.only ? String(q.only).split(',').map((n) => parseInt(n, 10)).filter(Boolean) : [15];
      const eventLogPages = q.elpages ? parseInt(q.elpages, 10) : undefined;
      const actions = q.actions ? String(q.actions).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const clearFirst = !!q.clear;
      const perPage = q.perpage ? parseInt(q.perpage, 10) : undefined;
      const maxPagesOverride = q.maxpages ? parseInt(q.maxpages, 10) : undefined;
      const t0 = Date.now();
      const summary = await backupTables({ only, writeAudit: !!q.audit, keepExisting: true, eventLogPages, clearFirst, actions, perPage, maxPagesOverride });
      return { statusCode: 200, body: JSON.stringify({ ok: true, probe: true, ms: Date.now() - t0, summary }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
    }
  }

  const manualOk = q.secret === admin;
  const isCron = !q.secret && !q.probe; // scheduled invocation carries no query params
  if (!manualOk && !isCron) return { statusCode: 401, body: 'unauthorized' };

  // Fire the heavy worker (background fn returns 202 quickly); don't block the cron.
  try {
    const url = `${SITE}/.netlify/functions/nightly-backup-background?secret=${encodeURIComponent(admin)}`;
    await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => {});
    return { statusCode: 200, body: JSON.stringify({ ok: true, triggered: true }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, triggered: true, note: String((e && e.message) || e) }) };
  }
};
