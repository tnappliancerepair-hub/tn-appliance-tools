// video-poster — save a still poster/thumbnail for a Studio clip so the cockpit can
// show WHAT'S IN the clip without playing it. The Studio grabs a frame client-side
// (a hidden muted <video> -> canvas), uploads the JPG to S3 (via s3-presign), then
// calls this to record the key on the job. video-jobs re-signs poster_key -> poster_url.
//   POST { secret, job_id, poster_key }   -> { ok, poster_key }
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { await setSecret(QUEUE_KEY, JSON.stringify(q)); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  const jobId = String(b.job_id || '');
  const key = String(b.poster_key || '').trim();
  if (!jobId || !key) return json(400, { error: 'job_id and poster_key required' });
  if (!/^social\/posters\//.test(key)) return json(400, { error: 'poster_key must be under social/posters/' });

  const q = await loadQueue();
  const job = q.find((j) => String(j.id) === jobId);
  if (!job) return json(404, { error: 'job_not_found' });
  job.poster_key = key;
  await saveQueue(q);
  return json(200, { ok: true, poster_key: key });
};
