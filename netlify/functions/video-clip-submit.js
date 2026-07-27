// video-clip-submit — the LONG-video path. Upload a full walkthrough / ride-along to
// S3, and Vizard cuts it into the best short moments. Each clip then flows through
// Submagic → the Studio queue (handled by vizard-poll). Owner-gated.
//
//   POST { secret, s3_key, project_name?, content_type?, max_clips?, mode? }
//     mode: "vizard" (default, FREE — Vizard captions in one pass, uses Creator credits)
//           "premium" (Vizard cuts raw → each clip through Submagic's captions)
//     -> { ok, clip_job }
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const vizard = require('./_lib/vizard');
const brands = require('./_lib/brands');

const CLIP_KEY = 'VIZARD_CLIP_JOBS';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadJobs() { try { return JSON.parse((await getSecretFresh(CLIP_KEY)) || '[]'); } catch (_) { return []; } }
async function saveJobs(j) { if (j.length > 100) j = j.slice(-100); await setSecret(CLIP_KEY, JSON.stringify(j)); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });

  if (!(await vizard.configured())) return json(400, { error: 'vizard_not_configured', note: 'Add VIZARDAI_API_KEY in the vault.' });

  // Source: either a freshly-uploaded S3 clip, OR an external URL (a Facebook/YouTube
  // link or any remote MP4 — lets us mine the existing back-catalog into shorts).
  const s3_key = String(b.s3_key || '').trim();
  const ext_url = String(b.video_url || '').trim();
  let videoUrl, videoType = 1;
  if (ext_url) {
    videoUrl = ext_url;
    videoType = parseInt(b.video_type, 10) || 1;   // 1 remote mp4, 2 YouTube, 11 Facebook
  } else if (s3_key) {
    const bucket = process.env.TN_AWS_S3_BUCKET;
    if (!bucket) return json(500, { error: 's3_not_configured' });
    // Raw S3 presigned GET URL. Unlike Submagic, Vizard fetches with a plain GET and
    // reads the size from S3's Content-Length (a streamed/chunked proxy has none ->
    // Vizard error 4005 "0 Bytes"). The key already carries the real extension. 12h TTL.
    try {
      const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
      videoUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: s3_key, ResponseContentType: 'video/mp4' }), { expiresIn: 12 * 3600 });
    } catch (e) { return json(502, { error: 'sign_failed', detail: String((e && e.message) || e) }); }
  } else {
    return json(400, { error: 's3_key or video_url required' });
  }

  const project_name = String(b.project_name || 'TN Appliance').slice(0, 100);
  const content_type = String(b.content_type || 'hero').slice(0, 24);
  const mode = b.mode === 'premium' ? 'premium' : 'vizard';   // default = free Vizard captions
  // Vizard needs the container `ext` for remote files — read it off the source path
  // (the S3 presigned URL and the external URL both keep the real extension).
  let ext = 'mp4';
  const extSrc = (ext_url || s3_key).split('?')[0];
  const em = extSrc.match(/\.([a-z0-9]{2,4})$/i); if (em) ext = em[1].toLowerCase();
  const created = await vizard.createProject({ videoUrl, videoType, ext, projectName: project_name, maxClips: b.max_clips, captions: mode === 'vizard' });
  if (!created.ok) return json(502, { error: 'vizard_create_failed', detail: created.error || created.detail, code: created.code });

  const id = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const channel = brands.get(b.channel).key;   // which studio brand these clips belong to
  const clipJob = { id, s3_key, project_name, content_type, channel, mode, vizard_project_id: created.projectId, status: 'clipping', clip_count: 0, created_ms: Date.now() };
  const jobs = await loadJobs();
  jobs.push(clipJob);
  await saveJobs(jobs);
  return json(200, { ok: true, clip_job: { id, vizard_project_id: created.projectId, status: 'clipping', project_name } });
};
