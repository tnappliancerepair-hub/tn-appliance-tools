// video-rehost-background — copies finished clips off Vizard's CDN (attachment
// disposition + 7-day expiry) onto our own S3, so they play inline everywhere and
// never disappear. Background fn (15-min budget) — downloads each clip and uploads
// it, marks the job hosted + stores its clip_key. Triggered by video-jobs when it
// sees un-hosted ready clips, and runnable manually.
//   POST { secret } | { internal:true }
'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { await setSecret(QUEUE_KEY, JSON.stringify(q)); }

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin && b.secret !== admin && !b.internal) return json(401, { error: 'unauthorized' });

  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!bucket) return json(500, { error: 's3_not_configured' });
  const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });

  const queue = await loadQueue();
  const todo = queue.filter((j) => j.status === 'ready' && !j.hosted && j.download_url).slice(0, 20);
  let done = 0, failed = 0;
  for (const job of todo) {
    try {
      const r = await fetch(job.download_url);
      if (!r.ok) { failed++; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) { failed++; continue; }
      const key = 'social/clips/' + job.id + '.mp4';
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: 'video/mp4' }));
      job.clip_key = key; job.hosted = true; done++;
    } catch (_) { failed++; }
  }
  if (done) await saveQueue(queue);
  return json(200, { ok: true, rehosted: done, failed, remaining: queue.filter((j) => j.status === 'ready' && !j.hosted).length });
};
