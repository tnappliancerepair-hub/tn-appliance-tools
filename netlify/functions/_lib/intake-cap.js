// intake-cap — one shared cap on how many intake/scheduling outreach texts a
// single job can receive. Teddy 7/1: "limit the intake text to just twice. We
// can't spam them." The greeting + availability asks + nudges + intake link all
// come from different agents (loop + Netlify), so the cap is enforced on a
// COMMON event_log marker ('intake_outreach_sent' with metadata.job_id) that
// every sender writes + reads. Cap = 2 touches per job, total, across all
// senders. (The loop's colony-loop/sms.js honors the same marker.)
'use strict';

const crud = require('./xano/metadata-crud');

const CAP = Number(process.env.INTAKE_OUTREACH_CAP) > 0 ? Number(process.env.INTAKE_OUTREACH_CAP) : 2;

function metaOf(r) {
  let m = r && r.metadata;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
  return m || {};
}

// How many intake outreach texts have already gone to this job.
async function outreachCount(jobId) {
  const jid = Number(jobId);
  if (!jid) return 0;
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'intake_outreach_sent' }, { id: 'desc' }, 500);
    return (rows || []).filter((r) => Number(metaOf(r).job_id) === jid).length;
  } catch (_) { return 0; } // fail-open on read error — the per-agent dedup still guards
}

// True if this job has already hit the cap (skip sending).
async function overCap(jobId, max = CAP) {
  return (await outreachCount(jobId)) >= max;
}

// Record that an intake outreach text was sent for this job.
async function mark(jobId, action) {
  try { await crud.logEvent('intake_outreach_sent', { job_id: Number(jobId), via: String(action || ''), at_ms: Date.now() }); }
  catch (_) {}
}

module.exports = { CAP, outreachCount, overCap, mark };
