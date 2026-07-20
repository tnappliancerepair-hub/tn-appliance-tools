// video-submit — the "enhance" trigger. Takes a raw tripod clip already uploaded to
// S3 (via s3-presign PUT), signs a pull URL, and fires a Submagic caption/hook/reframe
// job. Stores the job in the vault queue (VIDEO_STUDIO_QUEUE). Submagic calls
// submagic-webhook on completion; video-jobs also polls as a fallback. Owner-gated.
//
//   POST { secret, s3_key, title, hook?, template?, content_type?, language? }
//     -> { ok, job }
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const submagic = require('./_lib/submagic');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
const WEBHOOK = 'https://tnapplianceexchange.net/.netlify/functions/submagic-webhook';
// Custom dictionary so captions spell the brand/appliance terms right.
const DICTIONARY = ['TN Appliance', 'Whirlpool', 'Maytag', 'Frigidaire', 'GE', 'LG', 'Samsung', 'KitchenAid', 'Kenmore', 'compressor', 'evaporator', 'thermostat', 'igniter'];

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { if (q.length > 200) q = q.slice(-200); await setSecret(QUEUE_KEY, JSON.stringify(q)); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });

  const s3_key = String(b.s3_key || '').trim();
  if (!s3_key) return json(400, { error: 's3_key required (upload the raw clip first)' });
  if (!(await submagic.configured())) return json(400, { error: 'submagic_not_configured', note: 'Add SUBMAGIC_API_KEY in the vault.' });
  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!bucket) return json(500, { error: 's3_not_configured' });

  // Sign a 6-hour pull URL so Submagic can fetch the raw clip.
  let videoUrl;
  try {
    const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
    videoUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: s3_key, ResponseContentType: 'video/mp4' }), { expiresIn: 6 * 3600 });
  } catch (e) { return json(502, { error: 'sign_failed', detail: String((e && e.message) || e) }); }

  const title = String(b.title || 'TN Appliance').slice(0, 100);
  const hook = String(b.hook || '').slice(0, 90);
  const template = String(b.template || '').slice(0, 40) || undefined;
  const content_type = String(b.content_type || 'hero').slice(0, 24);
  const language = String(b.language || 'en').slice(0, 8);

  const created = await submagic.createProject({ videoUrl, title, hook, template, language, webhookUrl: WEBHOOK, dictionary: DICTIONARY });
  if (!created.ok) return json(502, { error: 'submagic_create_failed', detail: created.error || created.detail });

  const id = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const job = {
    id, s3_key, title, hook, content_type, template: template || submagic.DEFAULT_TEMPLATE, language,
    submagic_id: created.id, status: created.status || 'processing',
    download_url: null, created_ms: Date.now(), ready_ms: null, posted: {},
  };
  const q = await loadQueue();
  q.push(job);
  await saveQueue(q);
  return json(200, { ok: true, job: { id: job.id, submagic_id: job.submagic_id, status: job.status, title: job.title } });
};
