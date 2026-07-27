// video-prune — remove clips from the Studio queue (dedupe / clear test residue) AND
// clear stuck rows out of the "Long video → auto-clip" list. Owner-gated. Best-effort
// deletes the S3 copy too so we don't pay to store junk.
//   POST { secret, ids:[jobId,...] }                 -> remove these queue clips
//   POST { secret, title_contains:"robot", keep:1 }  -> keep top-N by viral score, drop the rest that match
//   POST { secret, clip_ids:[clipJobId,...] }         -> remove these auto-clip jobs
//   POST { secret, clip_status:"timeout" }            -> remove all auto-clip jobs with that status
//   POST { secret, clip_status:["timeout","failed"] } -> ...or any of these statuses
'use strict';
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
const CLIP_KEY = 'VIZARD_CLIP_JOBS';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { await setSecret(QUEUE_KEY, JSON.stringify(q)); }
async function loadClips() { try { return JSON.parse((await getSecretFresh(CLIP_KEY)) || '[]'); } catch (_) { return []; } }
async function saveClips(c) { await setSecret(CLIP_KEY, JSON.stringify(c)); }
const score = (j) => parseFloat(j.viral_score) || 0;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });

  const s3Bucket = process.env.TN_AWS_S3_BUCKET;
  const s3 = s3Bucket ? new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } }) : null;

  // ---- Auto-clip (Vizard long-video) list: remove by id or by status ----
  const wantClipIds = new Set((b.clip_ids || []).map(String));
  const wantClipStatuses = new Set((Array.isArray(b.clip_status) ? b.clip_status : (b.clip_status ? [b.clip_status] : [])).map((s) => String(s).toLowerCase()));
  if (wantClipIds.size || wantClipStatuses.size) {
    let clips = await loadClips();
    const dropClip = (c) => wantClipIds.has(String(c.id)) || wantClipStatuses.has(String(c.status || '').toLowerCase());
    const removedClips = clips.filter(dropClip);
    clips = clips.filter((c) => !dropClip(c));
    await saveClips(clips);
    if (s3) { for (const c of removedClips) { for (const k of [c.s3_key, c.clip_key]) { if (k) { try { await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: k })); } catch (_) {} } } } }
    return json(200, { ok: true, removed_clip_jobs: removedClips.length, remaining_clip_jobs: clips.length, removed_clip_titles: removedClips.map((c) => c.project_name).slice(0, 30) });
  }

  let queue = await loadQueue();
  let removeIds = new Set((b.ids || []).map(String));

  if (b.title_contains) {
    const kw = String(b.title_contains).toLowerCase();
    const keep = Math.max(parseInt(b.keep, 10) || 0, 0);
    const matches = queue.filter((j) => (j.title || '').toLowerCase().includes(kw)).sort((a, z) => score(z) - score(a));
    matches.slice(keep).forEach((j) => removeIds.add(String(j.id)));
  }
  if (!removeIds.size) return json(200, { ok: true, removed: 0, note: 'nothing matched' });

  const removed = queue.filter((j) => removeIds.has(String(j.id)));
  queue = queue.filter((j) => !removeIds.has(String(j.id)));
  await saveQueue(queue);

  // best-effort S3 cleanup
  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (bucket) {
    const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
    for (const j of removed) { if (j.clip_key) { try { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: j.clip_key })); } catch (_) {} } }
  }
  return json(200, { ok: true, removed: removed.length, remaining: queue.length, removed_titles: removed.map((j) => j.title).slice(0, 30) });
};
