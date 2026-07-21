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

const CLIP_KEY = 'VIZARD_CLIP_JOBS';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadJobs() { try { return JSON.parse((await getSecretFresh(CLIP_KEY)) || '[]'); } catch (_) { return []; } }
async function saveJobs(j) { if (j.length > 100) j = j.slice(-100); await setSecret(CLIP_KEY, JSON.stringify(j)); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });

  const s3_key = String(b.s3_key || '').trim();
  if (!s3_key) return json(400, { error: 's3_key required (upload the long video first)' });
  if (!(await vizard.configured())) return json(400, { error: 'vizard_not_configured', note: 'Add VIZARDAI_API_KEY in the vault.' });
  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!bucket) return json(500, { error: 's3_not_configured' });

  // Vizard clip links are valid 7 days; give the source a long enough pull window.
  let videoUrl;
  try {
    const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
    videoUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: s3_key, ResponseContentType: 'video/mp4' }), { expiresIn: 12 * 3600 });
  } catch (e) { return json(502, { error: 'sign_failed', detail: String((e && e.message) || e) }); }

  const project_name = String(b.project_name || 'TN Appliance').slice(0, 100);
  const content_type = String(b.content_type || 'hero').slice(0, 24);
  const mode = b.mode === 'premium' ? 'premium' : 'vizard';   // default = free Vizard captions
  const created = await vizard.createProject({ videoUrl, projectName: project_name, maxClips: b.max_clips, captions: mode === 'vizard' });
  if (!created.ok) return json(502, { error: 'vizard_create_failed', detail: created.error || created.detail, code: created.code });

  const id = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const clipJob = { id, s3_key, project_name, content_type, mode, vizard_project_id: created.projectId, status: 'clipping', clip_count: 0, created_ms: Date.now() };
  const jobs = await loadJobs();
  jobs.push(clipJob);
  await saveJobs(jobs);
  return json(200, { ok: true, clip_job: { id, vizard_project_id: created.projectId, status: 'clipping', project_name } });
};
