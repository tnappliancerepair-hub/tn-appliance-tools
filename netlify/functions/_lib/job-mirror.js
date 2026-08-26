// job-mirror — shared helpers for Phase 0 Part B (per-job read mirror).
//
// The tech app reads a job via Xano get_job_for_dashboard. When Xano is slow that read
// hangs ("Loading job…" forever). job-view-fast tries Xano first (short time-box, for
// freshness) then falls back to the Supabase job_mirror so a read is never stuck. This
// module holds the two shared bits: fetch a job from Xano, and upsert it into the mirror.
'use strict';

const sb = require('./supabase');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Fetch a job's full dashboard payload from Xano, time-boxed. Returns the parsed
// {success,...} object on success, or throws (timeout / non-2xx / success:false).
async function fetchJobFromXano(jobId, ms = 6000) {
  const r = await fetch(`${XANO}/get_job_for_dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId }),
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`get_job_for_dashboard -> ${r.status}`);
  const d = await r.json();
  if (!d || !d.success) throw new Error('not_success');
  return d;
}

// Upsert a fresh payload into job_mirror (best-effort — never throws into a caller).
async function putJobMirror(jobId, payload) {
  try {
    await sb.upsert('job_mirror', {
      job_id: Number(jobId),
      payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'job_id' });
    return true;
  } catch (e) {
    console.error('[job-mirror] put failed: ' + (e.message || e));
    return false;
  }
}

// Read a job's mirrored payload (or null). Returns { payload, updated_at } | null.
async function getJobMirror(jobId) {
  try {
    const rows = await sb.select('job_mirror', {
      select: 'payload,updated_at',
      job_id: 'eq.' + Number(jobId),
      limit: '1',
    });
    if (Array.isArray(rows) && rows.length) return rows[0];
  } catch (_) {}
  return null;
}

module.exports = { fetchJobFromXano, putJobMirror, getJobMirror, XANO };
