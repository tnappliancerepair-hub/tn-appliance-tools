// submagic-webhook — Submagic calls this when a project finishes. We match the
// payload's project id to a job in VIDEO_STUDIO_QUEUE and stamp the finished
// downloadUrl + status. Draft-first: we do NOT auto-post — the finished clip waits
// in the studio for Teddy to tap "Post everywhere."
//   POST (Submagic payload: { id, status, downloadUrl|directUrl, ... })
'use strict';
const { getSecretFresh, setSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { await setSecret(QUEUE_KEY, JSON.stringify(q)); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) {}
  const pid = p.id || p.projectId || (p.project && p.project.id);
  const status = p.status || (p.project && p.project.status) || '';
  const dl = p.downloadUrl || p.directUrl || (p.project && (p.project.downloadUrl || p.project.directUrl)) || null;
  if (!pid) return json(200, { ok: true, ignored: 'no project id' });

  const q = await loadQueue();
  const job = q.find((j) => j.submagic_id === pid);
  if (!job) return json(200, { ok: true, ignored: 'unknown project', pid });

  if (status === 'completed' && dl) {
    job.status = 'ready';
    job.download_url = dl;
    job.ready_ms = Date.now();
  } else if (status === 'failed') {
    job.status = 'failed';
  } else {
    job.status = status || job.status;
  }
  await saveQueue(q);
  try { await crud.logEvent('video_submagic_' + (job.status || 'update'), { job_id: job.id, submagic_id: pid, status: job.status, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: true, job_id: job.id, status: job.status });
};
