'use strict';
// One-time cleanup. The practice-auto-schedule-cron placed PRACTICE_<date> test
// assignments onto REAL warranty jobs (technician_id + scheduled_start +
// scheduling_status="scheduled"), so they're hidden from techs (the dashboard
// filters PRACTICE) AND gone from Danielle's needs-scheduled queue — ~40 real
// jobs in limbo. This resets every PRACTICE-tagged job back to needs-scheduled
// (clears tech, time, status, and the tag) so the office can really schedule them.
//
//   GET ?secret=...               -> DRY RUN: lists what it WOULD reset
//   GET ?secret=...&confirm=yes    -> actually reset them
const crud = require('./_lib/xano/metadata-crud');
const SECRET = 'tn-practice-cleanup-2026';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.secret !== SECRET) return j(401, { ok: false, error: 'unauthorized' });
  const confirm = q.confirm === 'yes';

  // Pull scheduled jobs (the practice cron sets scheduling_status="scheduled"),
  // then keep only the PRACTICE-tagged ones.
  let rows = [];
  try {
    rows = await crud.searchPage(crud.TABLES.jobs, { scheduling_status: 'scheduled' }, { id: 'desc' }, 2000);
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }

  const practice = rows.filter((r) => String(r.test_run_id || '').startsWith('PRACTICE'));
  const list = practice.map((r) => ({
    id: r.id, technician_id: r.technician_id, tag: r.test_run_id,
    claim: r.claim_number || '', customer: r.customer_first_name || '',
  }));

  if (!confirm) {
    return j(200, { ok: true, dry_run: true, scheduled_scanned: rows.length, would_reset: list.length, jobs: list });
  }

  let reset = 0; const failed = [];
  for (const r of practice) {
    try {
      await crud.update(crud.TABLES.jobs, r.id, {
        scheduling_status: 'not_ready',
        current_status: 'pending',
        technician_id: null,
        scheduled_start: null,
        scheduled_end: null,
        test_run_id: '',
      });
      reset++;
    } catch (e) {
      failed.push({ id: r.id, error: String((e && e.message) || e) });
    }
  }
  try { await crud.logEvent('practice_placements_cleared', { reset, failed: failed.length, at_ms: Date.now() }); } catch (_) {}
  return j(200, { ok: true, reset, failed_count: failed.length, failed });
};

function j(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
