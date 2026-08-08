// tech-undo-completion — the field "oops, I mis-tapped" button. A tech who hit the
// wrong disposition (e.g. 🔁 Recommend replacement when he meant 🙋 Pass off, or
// Complete on the wrong job) can reopen it himself instead of calling the office.
//
// Andre 2026-08-08: hit "Recommend replacement" (no_repair → scheduling_status
// 'no_fix_possible', a terminal state) and needed it changed to a reassignment.
// There was no tech-side way to undo a completion — this is that way.
//
// The completion state machine LOCKS terminal states, so a normal status write
// no-ops. A DIRECT metadata-API write (crud.update) bypasses the state machine —
// same override the office board's drag uses — reopening the job to 'scheduled' and
// clearing job_completed_at so the tech can pick the correct disposition, or the
// office/tech can reassign it.
//
//   POST { job_id, technician_id, reason? }  ->  { ok, job_id, reopened_from }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const TABLES = crud.TABLES;

function j(c, b) {
  return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: JSON.stringify(b) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id || 0, 10);
  const techId = parseInt(b.technician_id || 0, 10);
  const reason = String(b.reason || '').slice(0, 200);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  let prev = null;
  try {
    const job = await crud.searchOne(TABLES.jobs, { id: jobId });
    prev = job ? String(job.scheduling_status || '') : null;
  } catch (_) { /* proceed; the write is the important part */ }

  // Reopen: direct write bypasses the terminal lock. 'scheduled' keeps the job on
  // the tech's day + visible on the office board so it can be reassigned/redone.
  try {
    await crud.update(TABLES.jobs, jobId, { scheduling_status: 'scheduled', current_status: 'scheduled', job_completed_at: null });
  } catch (e) {
    return j(200, { ok: false, error: 'reopen failed: ' + String((e && e.message) || e).slice(0, 120) });
  }

  try { await crud.logEvent('tech_undo_completion', { job_id: jobId, technician_id: techId, from: prev, reason, at_ms: Date.now() }); } catch (_) {}
  return j(200, { ok: true, job_id: jobId, reopened_from: prev });
};
