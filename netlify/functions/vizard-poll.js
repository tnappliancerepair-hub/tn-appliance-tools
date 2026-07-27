// vizard-poll — Vizard has no per-request webhook, so we poll. For every clip-job
// still "clipping", ask Vizard for its clips; when ready, push EACH clip through
// Submagic into the Studio queue (branded captions/hook) and mark the clip-job done.
// Runs on a cron + manually. Owner-gated for manual runs; cron self-authorizes.
//   GET ?secret=<VAPI_ADMIN_SECRET>   (manual)   |   scheduled (cron)
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const vizard = require('./_lib/vizard');
const { enqueueFromVideoUrl, enqueueReady } = require('./_lib/video-queue');
const crud = require('./_lib/xano/metadata-crud');

const CLIP_KEY = 'VIZARD_CLIP_JOBS';
const MAX_AGE_MS = 3 * 3600 * 1000; // give up after 3h
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadJobs() { try { return JSON.parse((await getSecretFresh(CLIP_KEY)) || '[]'); } catch (_) { return []; } }
async function saveJobs(j) { await setSecret(CLIP_KEY, JSON.stringify(j)); }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return json(401, { error: 'unauthorized' });
  if (!(await vizard.configured())) return json(200, { ok: true, skipped: 'vizard_not_configured' });

  const jobs = await loadJobs();
  const pending = jobs.filter((j) => j.status === 'clipping');
  if (!pending.length) return json(200, { ok: true, pending: 0 });

  const out = [];
  for (const job of pending) {
    if (Date.now() - job.created_ms > MAX_AGE_MS) { job.status = 'timeout'; out.push({ id: job.id, timeout: true }); continue; }
    const r = await vizard.getClips(job.vizard_project_id);
    if (!r.ok) { out.push({ id: job.id, error: r.error }); continue; }
    if (!r.ready) { out.push({ id: job.id, still: 'clipping' }); continue; }

    const premium = job.mode === 'premium';
    let made = 0;
    for (const clip of r.clips) {
      if (!clip.videoUrl) continue;
      const meta = { videoUrl: clip.videoUrl, title: clip.title || job.project_name, content_type: job.content_type, source: 'vizard', viral_score: clip.viralScore || null, channel: job.channel || 'tn_appliance' };
      // premium → Submagic captions; default → Vizard already captioned it, straight to ready.
      const eq = premium ? await enqueueFromVideoUrl(meta) : await enqueueReady(meta);
      if (eq.ok) made++;
    }
    job.status = 'done';
    job.clip_count = made;
    out.push({ id: job.id, clips_enqueued: made });
    try { await crud.logEvent('vizard_clips_ingested', { clip_job: job.id, project_id: job.vizard_project_id, clips: made, at_ms: Date.now() }); } catch (_) {}
  }
  await saveJobs(jobs);
  return json(200, { ok: true, processed: out });
};
