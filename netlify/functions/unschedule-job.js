// unschedule-job — move a job OUT of the schedule (back to needs-scheduled)
// WITHOUT canceling it. Clears the scheduled time so it leaves the calendar/day
// and returns to the unscheduled tray. Keeps the customer + job intact.
//
//   POST { job_id, keep_tech? }   keep_tech=true leaves the tech assigned
//   -> { ok }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'job_id required' }) };

  const patch = {
    scheduling_status: 'not_ready',
    current_status: 'pending',
    scheduled_start: null,
    scheduled_end: null,
  };
  if (b.keep_tech !== true) patch.technician_id = null;

  try {
    await crud.update(crud.TABLES.jobs, jobId, patch);
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
  await crud.logEvent('job_unscheduled_from_office', { job_id: jobId, kept_tech: b.keep_tech === true, at_ms: Date.now() });
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
