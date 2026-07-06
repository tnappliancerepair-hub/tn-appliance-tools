// reset-job-lifecycle — clears the stale en-route / started timestamps on a job
// so the tech lifecycle buttons (On my way / Start) work again on a RETURN VISIT.
//
// The bug: tech_on_the_way refuses when tech_en_route_at is already set ("already
// sent") and tech_job_started refuses when job_started_at is set — but those flags
// are NOT reset when a job is rescheduled for a 2nd trip. So on any return visit the
// buttons lock (show "tap to retry"). This clears them for a given job.
//
//   POST { job_id, secret }   secret = VAPI_ADMIN_SECRET
// Admin-gated. Returns the cleared job_id. Idempotent.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const TABLES = crud.TABLES;

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const secret = b.secret || q.secret || '';
  const expected = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (secret !== expected) return j(401, { ok: false, error: 'unauthorized' });
  const jobId = parseInt(b.job_id || q.job_id || 0, 10);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  try {
    // PUT partial → preserves every other field, only clears the lifecycle stamps.
    // job_completed_at included: a prior DIAGNOSTIC trip that was "completed for the
    // day" leaves this set, which makes tech_job_complete throw "job already completed"
    // when the tech comes back and finishes the real repair. Clearing it lets a return
    // visit record the true repair completion.
    const cleared = { tech_en_route_at: null, job_started_at: null, eta_ms: null, job_completed_at: null };
    await crud.update(TABLES.jobs, jobId, cleared);
    try { await crud.logEvent('job_lifecycle_reset', { job_id: jobId, cleared: Object.keys(cleared), by: 'admin', at_ms: Date.now() }); } catch (_) {}
    return j(200, { ok: true, job_id: jobId, cleared: Object.keys(cleared) });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
