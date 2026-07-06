// tech-complete — the completion proxy that models "diagnostic done" vs "job done."
//
// Teddy's field insight (7/6): there are DIFFERENT kinds of complete. A diagnostic /
// parts trip is "done for the day, coming back" — the JOB is NOT finished. But the
// underlying tech_job_complete stamps job_completed_at on EVERY completion type, so a
// parts-needed trip marks the job "done," and then the idempotency gate throws
// "job already completed" when the tech returns to finish the real repair (this is
// what blocked Colston). The XS fix needs a Mac push; this wrapper fixes it live:
//
//   • Before completing: if a "done" stamp is blocking but the job is NOT actually
//     terminal (it's scheduled / in_progress / awaiting_parts), clear it so THIS
//     visit's completion records. Retry once if the gate still fires.
//   • After a NON-terminal completion (parts_needed / warranty_auth_needed /
//     reassignment_needed): strip job_completed_at back off — the job is coming back,
//     it isn't done — so the return trip can complete cleanly.
//   • repair_complete / no_repair are TERMINAL: the "done" stamp stays.
//
//   POST { job_id, technician_id, completion_type }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const TABLES = crud.TABLES;
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const NONTERMINAL = new Set(['parts_needed', 'warranty_auth_needed', 'reassignment_needed']);

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: JSON.stringify(b) }; }

async function callComplete(payload) {
  try {
    const r = await fetch(`${XANO}/tech_job_complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    return await r.json().catch(() => ({}));
  } catch (_) { return { success: false, error: 'connection error' }; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id || 0, 10);
  const techId = parseInt(b.technician_id || 0, 10);
  const ct = String(b.completion_type || '');
  if (!jobId || !techId || !ct) return j(400, { success: false, error: 'job_id, technician_id, completion_type required' });

  // Look at the job's real state; clear a stale/blocking "done" stamp if the job isn't
  // actually terminal, so this visit's completion isn't refused.
  let trulyDone = false;
  try {
    const job = await crud.searchOne(TABLES.jobs, { id: jobId });
    if (job) {
      const status = String(job.scheduling_status || '').toLowerCase();
      trulyDone = status === 'completed' || status === 'no_fix_possible';
      if (job.job_completed_at && !trulyDone) {
        try { await crud.update(TABLES.jobs, jobId, { job_completed_at: null }); } catch (_) {}
      }
    }
  } catch (_) { /* proceed — the XS gate is still the backstop */ }

  const payload = { job_id: jobId, technician_id: techId, completion_type: ct };
  let d = await callComplete(payload);

  // Still blocked by a stale stamp (race / not-yet-cleared) and the job wasn't truly
  // done → clear + retry once.
  if (d && d.success === false && /already (complete|completed)/i.test(String(d.error || '')) && !trulyDone) {
    try { await crud.update(TABLES.jobs, jobId, { job_completed_at: null }); } catch (_) {}
    d = await callComplete(payload);
  }

  // Non-terminal completion = the job is coming back, not finished. The XS stamped
  // job_completed_at anyway; strip it so the next trip can complete cleanly.
  if (d && d.success && NONTERMINAL.has(ct)) {
    try { await crud.update(TABLES.jobs, jobId, { job_completed_at: null }); await crud.logEvent('diagnostic_visit_not_terminal', { job_id: jobId, completion_type: ct, at_ms: Date.now() }); } catch (_) {}
  }

  return j(200, d && typeof d === 'object' ? d : { success: false, error: 'no response' });
};
