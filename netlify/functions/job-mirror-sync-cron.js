// job-mirror-sync-cron — Phase 0 Part B: pre-warm the per-job read mirror.
//
// job-view-fast warms job_mirror on every healthy read, but if Xano is ALREADY down
// when a tech first opens a job, opportunistic warming never happened. This cron
// pre-warms today's active jobs while Xano is still healthy, so even a first cold open
// during an outage is instant.
//
// Cheap + bounded: it picks its target list from the Supabase board_mirror (NO Xano
// cost to choose), refreshes only jobs whose mirror is missing or stale, caps the batch,
// and runs small-concurrency. Gated by JOB_VIEW_FAST (skips entirely when the feature is
// off, so it never adds Xano load unless the read path is actually using it).
'use strict';

const sb = require('./_lib/supabase');
const { fetchJobFromXano, putJobMirror } = require('./_lib/job-mirror');

// statuses a tech actually opens on the job page
const ACTIVE = new Set(['not_ready', 'scheduled', 'in_progress', 'awaiting_parts', 'held']);
const STALE_MS = 8 * 60 * 1000;   // refresh a mirror row older than this
const CAP = 40;                   // max jobs refreshed per run (bounds Xano load)
const CONCURRENCY = 4;

const flagOn = () => String(process.env.JOB_VIEW_FAST || '').trim().toLowerCase() === 'true';

exports.handler = async function () {
  if (!flagOn()) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'flag_off' }) };

  const out = { ok: true, candidates: 0, refreshed: 0, failed: 0 };
  try {
    if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'supabase_not_configured' }) };

    // 1) active jobs with a tech, straight from the board mirror (no Xano hit)
    const board = await sb.select('board_mirror', {
      select: 'id,technician_id,scheduling_status',
      limit: '2000',
    }).catch(() => []);
    const active = (Array.isArray(board) ? board : []).filter(
      (j) => j && j.technician_id && ACTIVE.has(String(j.scheduling_status || ''))
    );

    // 2) current mirror freshness
    const mirror = await sb.select('job_mirror', { select: 'job_id,updated_at', limit: '5000' }).catch(() => []);
    const freshAt = new Map();
    for (const m of (Array.isArray(mirror) ? mirror : [])) freshAt.set(Number(m.job_id), Date.parse(m.updated_at || 0) || 0);

    const now = Date.now();
    const stale = active
      .filter((j) => (now - (freshAt.get(Number(j.id)) || 0)) > STALE_MS)
      .map((j) => Number(j.id));
    // oldest-first (missing = 0 = oldest), then cap
    stale.sort((a, b) => (freshAt.get(a) || 0) - (freshAt.get(b) || 0));
    const batch = stale.slice(0, CAP);
    out.candidates = batch.length;

    // 3) refresh in small concurrent waves
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const wave = batch.slice(i, i + CONCURRENCY);
      await Promise.all(wave.map(async (jobId) => {
        try {
          const d = await fetchJobFromXano(jobId, 8000);
          await putJobMirror(jobId, d);
          out.refreshed++;
        } catch (_) { out.failed++; }
      }));
    }
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e), ...out }) };
  }
  return { statusCode: 200, body: JSON.stringify(out) };
};
