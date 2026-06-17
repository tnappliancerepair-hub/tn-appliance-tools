'use strict';
// One-time cleanup. The practice-auto-schedule-cron placed PRACTICE_<date> test
// assignments onto jobs (technician_id + scheduled_start + scheduling_status=
// "scheduled"), so they're hidden from techs (the dashboard filters PRACTICE)
// AND gone from Danielle's needs-scheduled queue. This sorts every PRACTICE-
// tagged job into the RIGHT action instead of one blunt reset:
//
//   RECOVER  real warranty jobs (have a claim #), non-terminal  -> back to
//            needs-scheduled (clear tech/time/tag) so Danielle sees them again.
//   CANCEL   fake test jobs (no claim #), non-terminal          -> canceled so
//            they stop showing on techs' days and don't flood the live queue.
//   SKIP     already canceled / completed / awaiting_parts      -> left as-is
//            (don't resurrect canceled, reset a completed job, or lose parts).
//
//   GET ?secret=...               -> DRY RUN: the full split + samples
//   GET ?secret=...&confirm=yes    -> execute
const crud = require('./_lib/xano/metadata-crud');

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const JOBS_TABLE = 7;
const SECRET = 'tn-practice-cleanup-2026';

// Statuses we never touch (terminal, or parts-state we must preserve).
const SKIP_STATUS = new Set(['canceled', 'cancelled', 'completed', 'awaiting_parts']);

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

function classify(r) {
  const status = String(r.scheduling_status || '').toLowerCase();
  if (SKIP_STATUS.has(status)) return 'skip';
  const hasClaim = String(r.claim_number || '').trim().length > 0;
  return hasClaim ? 'recover' : 'cancel';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.secret !== SECRET) return j(401, { ok: false, error: 'unauthorized' });
  const confirm = q.confirm === 'yes';

  let practice = [];
  try { practice = await findPracticeJobs(25); }
  catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }

  const buckets = { recover: [], cancel: [], skip: [] };
  for (const r of practice) buckets[classify(r)].push(r);

  const sample = (arr) => arr.slice(0, 10).map((r) => ({
    id: r.id, tech: r.technician_id, status: r.scheduling_status,
    tag: r.test_run_id, claim: r.claim_number || '', customer: r.customer_first_name || '',
  }));

  if (!confirm) {
    return j(200, {
      ok: true, dry_run: true, total: practice.length,
      counts: { recover: buckets.recover.length, cancel: buckets.cancel.length, skip: buckets.skip.length },
      recover_sample: sample(buckets.recover),
      cancel_sample: sample(buckets.cancel),
      skip_sample: sample(buckets.skip),
    });
  }

  let recovered = 0, canceled = 0; const failed = [];
  for (const r of buckets.recover) {
    try {
      await crud.update(JOBS_TABLE, r.id, {
        scheduling_status: 'not_ready', current_status: 'pending',
        technician_id: null, scheduled_start: null, scheduled_end: null, test_run_id: '',
      });
      recovered++;
    } catch (e) { failed.push({ id: r.id, op: 'recover', error: String((e && e.message) || e) }); }
  }
  for (const r of buckets.cancel) {
    try {
      await crud.update(JOBS_TABLE, r.id, {
        scheduling_status: 'canceled', current_status: 'canceled',
        technician_id: null, scheduled_start: null, scheduled_end: null, test_run_id: '',
      });
      canceled++;
    } catch (e) { failed.push({ id: r.id, op: 'cancel', error: String((e && e.message) || e) }); }
  }
  try { await crud.logEvent('practice_placements_cleared', { recovered, canceled, skipped: buckets.skip.length, failed: failed.length, at_ms: Date.now() }); } catch (_) {}
  return j(200, { ok: true, recovered, canceled, skipped: buckets.skip.length, failed_count: failed.length, failed });
};

function j(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
