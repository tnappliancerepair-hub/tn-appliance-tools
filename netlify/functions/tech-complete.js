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
// completion_type -> the scheduling_status the completion INTENDS (mirrors the XS map).
// The XS delegates the scheduling_status write to the state machine, which can no-op
// (esp. the auto-start scheduled->in_progress->completed two-hop). When it does, the
// job keeps job_completed_at (tech sees "Done") but scheduling_status stays 'scheduled'
// (office sees "not complete") — Jimmy 2026-07-13: "we mark complete, office isn't
// showing it complete, keeps getting asked if it's done." We reconcile it here.
// reassignment_needed (🙋 Pass off — 2nd opinion) lands on 'held' — NOT needs_more_info,
// which is a board blind spot the office board never renders (the job would vanish). 'held'
// is in the board feed and routes to the tech's Report folder, and the second_opinion_
// requested marker (logged below) drives the ORANGE siren so the office jumps on it.
const STATUS_MAP = { repair_complete: 'completed', no_repair: 'no_fix_possible', parts_needed: 'awaiting_parts', warranty_auth_needed: 'held', reassignment_needed: 'held' };

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

  // 🙋 SECOND OPINION marker → the office board flags it with an ORANGE siren so Danielle
  // uploads it to the warranty company for a 2nd opinion. (Teddy 2026-07-16, option 4.)
  if (d && d.success && ct === 'reassignment_needed') {
    try { await crud.logEvent('second_opinion_requested', { job_id: jobId, technician_id: techId, at_ms: Date.now() }); } catch (_) {}
  }

  // RECONCILE — guarantee the office sees what the tech sees. The XS leaves
  // scheduling_status to the state machine; if that no-opped, the office board (which
  // reads scheduling_status) never shows the job complete while the tech app (which
  // reads job_completed_at) does. After a successful completion, re-read the job and,
  // if scheduling_status didn't land on the intended status, force it so both agree.
  if (d && d.success) {
    const want = STATUS_MAP[ct] || 'completed';
    try {
      const job = await crud.searchOne(TABLES.jobs, { id: jobId });
      const have = String((job && job.scheduling_status) || '').toLowerCase();
      if (job && have !== want) {
        await crud.update(TABLES.jobs, jobId, { scheduling_status: want, current_status: want });
        await crud.logEvent('tech_complete_status_reconciled', { job_id: jobId, completion_type: ct, from: have, to: want, at_ms: Date.now() });
      }
    } catch (_) { /* the office 'Not closed out' flag is still the backstop */ }
  }

  return j(200, d && typeof d === 'object' ? d : { success: false, error: 'no response' });
};
