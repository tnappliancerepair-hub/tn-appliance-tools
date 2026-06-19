// flag-job-needs-availability — the LAST rung of the availability ladder.
// When Ant's text + follow-up text + Vapi call all fail to get the customer's
// availability, the job gets a visible flag in the office "Needs Scheduled"
// view so Teddy / Danielle can reach them by hand. Sets jobs.friendly_status
// (the field needs-scheduled.html already renders). Idempotent — re-flagging
// is harmless. Clears the flag when availability finally comes in (clear=true).
//
//   POST { job_id, clear? }
//
// Runs open like set-job-availability (Metadata token stays server-side; it
// only writes a status string to a job).
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const JOBS_TABLE = 7;

// The marker text. needs-scheduled.html keys its amber "call them" banner off
// the "NEEDS CALL" substring, so keep that token if you change the wording.
const FLAG = '📞 NEEDS CALL — no availability yet';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id, 10);
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'job_id required' }) };

  const clear = b.clear === true || b.clear === 'true';
  try {
    await crud.update(JOBS_TABLE, jobId, { friendly_status: clear ? '' : FLAG });
    await crud.logEvent(clear ? 'availability_flag_cleared' : 'availability_flag_set', {
      job_id: jobId, actor: (b.actor || 'ant'),
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, success: true, job_id: jobId, flagged: !clear }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, success: false, error: String((e && e.message) || e) }) };
  }
};
