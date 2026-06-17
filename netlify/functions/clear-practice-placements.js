'use strict';
// One-time cleanup. The practice-auto-schedule-cron placed PRACTICE_<date> test
// assignments onto REAL warranty jobs (technician_id + scheduled_start +
// scheduling_status="scheduled"), so they're hidden from techs (the dashboard
// filters PRACTICE) AND gone from Danielle's needs-scheduled queue — ~40 real
// jobs in limbo. This finds every PRACTICE-tagged job and resets it back to
// needs-scheduled (clears tech, time, status, and the tag).
//
//   GET ?secret=...               -> DRY RUN: lists what it WOULD reset
//   GET ?secret=...&confirm=yes    -> actually reset them
const crud = require('./_lib/xano/metadata-crud');

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const JOBS_TABLE = 7;
const SECRET = 'tn-practice-cleanup-2026';

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Paginate the most-recent jobs (sort by id desc — no search filter, which 400s
// on enum fields) and filter for PRACTICE-tagged ones in JS.
async function findPracticeJobs(maxPages) {
  const PER = 200;
  const out = [];
  for (let p = 1; p <= maxPages; p++) {
    const r = await fetch(`${META}/table/${JOBS_TABLE}/content/search`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page: p }),
    });
    if (!r.ok) break;
    const j = await r.json().catch(() => ({}));
    const items = j.items || [];
    for (const it of items) {
      if (String(it.test_run_id || '').startsWith('PRACTICE')) out.push(it);
    }
    if (items.length < PER) break;
  }
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.secret !== SECRET) return j(401, { ok: false, error: 'unauthorized' });
  const confirm = q.confirm === 'yes';

  let practice = [];
  try { practice = await findPracticeJobs(25); }
  catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }

  const list = practice.map((r) => ({
    id: r.id, technician_id: r.technician_id, tag: r.test_run_id,
    status: r.scheduling_status, claim: r.claim_number || '', customer: r.customer_first_name || '',
  }));

  if (!confirm) {
    return j(200, { ok: true, dry_run: true, would_reset: list.length, jobs: list });
  }

  let reset = 0; const failed = [];
  for (const r of practice) {
    try {
      await crud.update(JOBS_TABLE, r.id, {
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
