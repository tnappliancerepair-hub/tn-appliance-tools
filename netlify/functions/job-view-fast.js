// job-view-fast — Phase 0 Part B: the tech app's job read that never freezes.
//
// tech-job.html used to read get_job_for_dashboard straight from Xano; when Xano is
// slow that hung on "Loading job…". This wraps the read:
//   - Try Xano FIRST with a short time-box (freshness when Xano is responsive), and on
//     success upsert the payload into the Supabase job_mirror (warming it for later).
//   - If Xano is slow/down, fall back INSTANTLY to the job_mirror copy — so the tech
//     still opens the job during an outage instead of hanging.
//
// Returns the SAME { success, job, tech, customer, appliance, all_tdrs, ... } shape as
// get_job_for_dashboard — a drop-in. X-Job-Source header says where it came from.
//
// SAFE + REVERSIBLE: gated by Netlify env flag JOB_VIEW_FAST. Read from process.env
// DIRECTLY (never getSecret) so the gate never depends on the flapping Xano vault.
//   - flag !== 'true' -> pure passthrough to Xano (today's exact behavior, no mirror).
// Flip the flag off = instant rollback to direct Xano.
'use strict';

const { fetchJobFromXano, putJobMirror, getJobMirror } = require('./_lib/job-mirror');

// Short box when the mirror is our safety net (fail fast to the mirror). Longer when
// there's no mirror to fall back to (this call IS the read).
const XANO_TRY_MS = 6000;
const XANO_ONLY_MS = 14000;

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const flagOn = () => String(process.env.JOB_VIEW_FAST || '').trim().toLowerCase() === 'true';

function jobIdFrom(event) {
  if (event.httpMethod === 'POST') {
    try { const b = JSON.parse(event.body || '{}'); if (b.job_id != null) return Number(b.job_id); } catch (_) {}
  }
  const q = (event.queryStringParameters || {});
  if (q.job_id != null && q.job_id !== '') return Number(q.job_id);
  return null;
}

function out(status, obj, source) {
  return { statusCode: status, headers: { ...CORS, ...(source ? { 'X-Job-Source': source } : {}) }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const jobId = jobIdFrom(event);
  if (jobId == null || Number.isNaN(jobId)) return out(400, { success: false, error: 'bad_job_id' });

  // ---- PASSTHROUGH (flag off) — today's exact behavior, straight Xano ----
  if (!flagOn()) {
    try {
      const d = await fetchJobFromXano(jobId, XANO_ONLY_MS);
      return out(200, d, 'xano_passthrough');
    } catch (e) {
      return out(502, { success: false, error: String(e.message || e) }, 'xano_error');
    }
  }

  // ---- FAST PATH (flag on): Xano first (short box) -> mirror fallback ----
  try {
    const d = await fetchJobFromXano(jobId, XANO_TRY_MS);
    // fresh copy in hand — warm the mirror for the next time Xano is down (fire-and-forget)
    putJobMirror(jobId, d).catch(() => {});
    return out(200, d, 'xano');
  } catch (_) {
    // Xano slow/down — serve the last good mirror copy so the tech isn't stuck.
    const row = await getJobMirror(jobId);
    if (row && row.payload) {
      // annotate lightly so the client can show a subtle "showing last synced" note
      const p = row.payload;
      try { p._mirror = true; p._mirror_at = row.updated_at; } catch (_) {}
      return out(200, p, 'mirror_fallback');
    }
    return out(502, { success: false, error: 'unavailable' }, 'no_source');
  }
};
