// video-queue — the one place a finished-or-pending clip becomes a Studio job.
// Both paths use it: a single raw upload (video-submit) and each auto-clip Vizard
// returns (vizard-poll). It fires the Submagic caption/hook job and pushes the job
// onto VIDEO_STUDIO_QUEUE so it shows in the cockpit and flows to post-everywhere.
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecretFresh, setSecret } = require('./secrets');
const submagic = require('./submagic');
const crud = require('./xano/metadata-crud');

// A signed S3 URL that PLAYS inline (native range support, no expiry problem —
// the object is ours). Used for re-hosted clips so <video> just works everywhere.
async function signedInlineUrl(key) {
  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!key || !bucket) return null;
  const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: 'video/mp4', ResponseContentDisposition: 'inline' }), { expiresIn: 6 * 3600 });
}

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
const WEBHOOK = 'https://tnapplianceexchange.net/.netlify/functions/submagic-webhook';
const DICTIONARY = ['TN Appliance', 'Whirlpool', 'Maytag', 'Frigidaire', 'GE', 'LG', 'Samsung', 'KitchenAid', 'Kenmore', 'compressor', 'evaporator', 'thermostat', 'igniter'];

async function loadQueue() { try { return JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) { return []; } }
async function saveQueue(q) { if (q.length > 300) q = q.slice(-300); await setSecret(QUEUE_KEY, JSON.stringify(q)); }

// meta: { videoUrl (required, public pull URL), s3_key?, title, hook?, content_type?,
//         template?, language?, source?, viral_score? }
async function enqueueFromVideoUrl(meta) {
  meta = meta || {};
  if (!meta.videoUrl) return { ok: false, error: 'videoUrl_required' };
  const created = await submagic.createProject({
    videoUrl: meta.videoUrl,
    title: meta.title || 'TN Appliance',
    hook: meta.hook || '',
    template: meta.template || undefined,
    language: meta.language || 'en',
    webhookUrl: WEBHOOK,
    dictionary: DICTIONARY,
  });
  if (!created.ok) return { ok: false, error: created.error || 'submagic_create_failed', detail: created.detail };

  const id = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const job = {
    id, s3_key: meta.s3_key || null, title: String(meta.title || 'TN Appliance').slice(0, 100),
    hook: String(meta.hook || '').slice(0, 90), content_type: String(meta.content_type || 'hero').slice(0, 24),
    template: meta.template || submagic.DEFAULT_TEMPLATE, language: meta.language || 'en',
    source: meta.source || 'upload', viral_score: meta.viral_score || null,
    submagic_id: created.id, status: created.status || 'processing',
    download_url: null, created_ms: Date.now(), ready_ms: null, posted: {},
  };
  const q = await loadQueue();
  q.push(job);
  await saveQueue(q);
  try { await crud.logEvent('video_job_enqueued', { job_id: id, source: job.source, submagic_id: created.id, at_ms: Date.now() }); } catch (_) {}
  return { ok: true, job };
}

// Push an ALREADY-FINISHED clip straight onto the queue as "ready" (no Submagic).
// Used by the Vizard-only volume path — Vizard captioned it in one pass.
// meta: { videoUrl (required), title, content_type?, source?, viral_score? }
async function enqueueReady(meta) {
  meta = meta || {};
  if (!meta.videoUrl) return { ok: false, error: 'videoUrl_required' };
  const id = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const job = {
    id, s3_key: null, title: String(meta.title || 'TN Appliance').slice(0, 100),
    hook: '', content_type: String(meta.content_type || 'hero').slice(0, 24),
    template: 'vizard', language: 'en', source: meta.source || 'vizard',
    viral_score: meta.viral_score || null, submagic_id: null,
    status: 'ready', download_url: meta.videoUrl, created_ms: Date.now(), ready_ms: Date.now(), posted: {},
  };
  const q = await loadQueue();
  q.push(job);
  await saveQueue(q);
  try { await crud.logEvent('video_job_ready', { job_id: id, source: job.source, at_ms: Date.now() }); } catch (_) {}
  return { ok: true, job };
}

module.exports = { QUEUE_KEY, loadQueue, saveQueue, enqueueFromVideoUrl, enqueueReady, signedInlineUrl };
