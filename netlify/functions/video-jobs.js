// video-jobs — the studio's queue reader. Lists every clip in the machine with its
// status + finished download URL. Also self-heals: any job still "processing" gets
// polled against Submagic (belt-and-suspenders in case a webhook was missed). The
// raw S3 clip is signed for inline preview. Owner-gated.
//   GET ?secret=<VAPI_ADMIN_SECRET>[&refresh=1]
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const submagic = require('./_lib/submagic');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { await setSecret(QUEUE_KEY, JSON.stringify(q)); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  let queue = await loadQueue();

  // Poll fallback: reconcile any not-yet-ready jobs against Submagic.
  if (q.refresh === '1' && (await submagic.configured())) {
    let changed = false;
    for (const job of queue) {
      if (job.status === 'ready' || job.status === 'failed' || job.status === 'posted') continue;
      if (!job.submagic_id) continue;
      const r = await submagic.getProject(job.submagic_id);
      if (!r.ok) continue;
      if (r.status === 'completed' && r.downloadUrl) { job.status = 'ready'; job.download_url = r.downloadUrl; job.ready_ms = Date.now(); changed = true; }
      else if (r.status === 'failed') { job.status = 'failed'; changed = true; }
      else if (r.status && r.status !== job.status) { job.status = r.status; changed = true; }
    }
    if (changed) await saveQueue(queue);
  }

  const bucket = process.env.TN_AWS_S3_BUCKET;
  const s3 = bucket ? new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } }) : null;
  async function rawPreview(key) {
    if (!s3) return null;
    try { return await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: 'inline' }), { expiresIn: 3600 }); } catch (_) { return null; }
  }

  const jobs = [];
  for (const j of queue.slice().reverse().slice(0, 60)) {
    jobs.push({
      id: j.id, title: j.title, hook: j.hook, content_type: j.content_type, template: j.template,
      status: j.status, download_url: j.status === 'ready' ? j.download_url : null,
      raw_preview: await rawPreview(j.s3_key),
      created_ms: j.created_ms, ready_ms: j.ready_ms || null, posted: j.posted || {},
    });
  }
  const counts = queue.reduce((a, j) => { a[j.status] = (a[j.status] || 0) + 1; return a; }, {});
  return json(200, { ok: true, configured: await submagic.configured(), counts, jobs });
};
