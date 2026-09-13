// nightly-backup — scheduled trigger (3:00am CT) + manual controls.
//   - cron (no params)            -> fires the background worker (full backup)
//   - ?secret=<admin>            -> manual full run (fires the background worker)
//   - ?probe=1&secret=<admin>    -> SMALL synchronous backup (technicians only),
//                                    returns the result so we can verify the whole
//                                    Xano->Supabase chain live without waiting.
//   - ?prune=1&secret=<admin>    -> run retention only, synchronously, and report
//                                    what it dropped/kept. &dry=1 to look first.
//
// The `schedule` block lives on nightly-backup-cron, NOT here: a Netlify fn that
// carries its own schedule edge-403s on every external HTTP call, which silently
// made all of the manual controls above unreachable.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { backupTables, pruneOldSnapshots } = require('./_lib/backup');
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

  // Retention only. Synchronous so the result is visible, and bounded by its own
  // budget. ?dry=1 reports what WOULD go without deleting anything.
  if (q.prune && q.secret === admin) {
    try {
      const t0 = Date.now();
      if (q.dry) {
        const rows = await sb.select('xano_backup_chunks', { select: 'snapshot_date,table_name', order: 'snapshot_date.desc', limit: '50000' });
        const byDate = {};
        for (const r of rows || []) {
          byDate[r.snapshot_date] = byDate[r.snapshot_date] || { chunks: 0, heavy: 0 };
          byDate[r.snapshot_date].chunks++;
          if (r.table_name === 'parts_orders') byDate[r.snapshot_date].heavy++;
        }
        const heavyDates = Object.keys(byDate).filter((d) => byDate[d].heavy > 0).sort().reverse();
        return { statusCode: 200, body: JSON.stringify({ ok: true, dry: true, ms: Date.now() - t0,
          total_dates: Object.keys(byDate).length, total_chunks: (rows || []).length,
          heavy_dates: heavyDates.length, heavy_keeping: heavyDates.slice(0, 2), heavy_dropping: heavyDates.slice(2).length }, null, 2) };
      }
      const budgetMs = q.budget_ms ? parseInt(q.budget_ms, 10) : 60000;
      const res = await pruneOldSnapshots(undefined, { budgetMs });
      return { statusCode: 200, body: JSON.stringify({ ok: true, ms: Date.now() - t0, prune: res }, null, 2) };
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
