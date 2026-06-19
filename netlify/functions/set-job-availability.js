// set-job-availability — manual entry of a customer's availability when Ant's
// SMS/portal/Vapi didn't get through and the office reached them by phone. Packs
// available + unavailable into jobs.customer_preference_text as AVAIL:/UNAVAIL:
// markers (the exact format every schedule view + the route-fill + the tech
// dashboard already read), so it shows for the tech + office from then on.
//
//   POST { job_id, available, unavailable, actor? }  ->  persists on the job
//
// Office board pages are already office-password gated; this only writes a
// plain-text availability string to a job, so it runs open like office-stage
// (the Metadata token stays server-side).
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const JOBS_TABLE = 7;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id, 10);
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'job_id required' }) };

  const avail = String(b.available || '').trim();
  const unavail = String(b.unavailable || '').trim();
  const parts = [];
  if (avail) parts.push('AVAIL: ' + avail);
  if (unavail) parts.push('UNAVAIL: ' + unavail);
  const packed = parts.join('\n');

  try {
    await crud.update(JOBS_TABLE, jobId, { customer_preference_text: packed });
    await crud.logEvent('office_availability_set', {
      job_id: jobId, available: avail, unavailable: unavail, actor: (b.actor || 'office'),
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, success: true, job_id: jobId, customer_preference_text: packed }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, success: false, error: String((e && e.message) || e) }) };
  }
};
