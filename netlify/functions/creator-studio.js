// creator-studio — a SCOPED door into the content engine for a single creator
// (a tech), gated by THEIR OWN code — never the master admin secret. A creator
// can only: upload their own clip, send it to the captions engine (tagged as
// theirs), and see their own queue. They cannot touch the shop's controls,
// vault, phones, scorecard, or other creators' clips.
//
//   POST { code, action:'me'|'submit'|'list', ... }
//     submit: { code, s3_key, title, hook?, content_type? } -> { ok, job }
//     list:   { code } -> { ok, jobs:[...] }   (this creator's clips only)
//
// Add a creator = one line in CREATORS. Code is read from the vault
// (CREATOR_CODE_<ID>), falling back to the seed below until you set one.
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const submagic = require('./_lib/submagic');
const { enqueueFromVideoUrl } = require('./_lib/video-queue');
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

// Roster of creators. code_env = vault key to override the seed code.
const CREATORS = {
  andre: { name: 'Andre', code_env: 'CREATOR_CODE_ANDRE', seed: 'andre-tn-2026' },
  // add more techs here later, e.g. jimmy/lee/john/teddy
};

async function auth(codeRaw) {
  const code = String(codeRaw || '').trim();
  if (!code) return null;
  for (const [id, c] of Object.entries(CREATORS)) {
    const real = String((await getSecretFresh(c.code_env)) || c.seed).trim();
    if (real && code === real) return { id, name: c.name };
  }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const who = await auth(b.code);
  if (!who) return json(401, { ok: false, error: 'bad_code' });
  const action = String(b.action || 'me');

  if (action === 'me') return json(200, { ok: true, creator: who });

  if (action === 'list') {
    let q = []; try { q = JSON.parse((await getSecretFresh('VIDEO_STUDIO_QUEUE')) || '[]'); } catch (_) {}
    const mine = q.filter((j) => j.creator === who.id)
      .sort((a, c) => (c.created_ms || 0) - (a.created_ms || 0))
      .slice(0, 30)
      .map((j) => ({ id: j.id, title: j.title, status: j.status, created_ms: j.created_ms, posted: j.posted || {}, download_url: j.status === 'ready' ? (j.download_url || null) : null }));
    return json(200, { ok: true, creator: who, jobs: mine });
  }

  if (action === 'submit') {
    const s3_key = String(b.s3_key || '').trim();
    if (!s3_key) return json(400, { ok: false, error: 's3_key required (upload the clip first)' });
    if (!(await submagic.configured())) return json(400, { ok: false, error: 'captions_engine_not_ready', note: 'SUBMAGIC_API_KEY not set — your video is saved; it will build once the key is in.' });
    const bucket = process.env.TN_AWS_S3_BUCKET;
    if (!bucket) return json(500, { ok: false, error: 's3_not_configured' });
    let videoUrl;
    try {
      const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
      videoUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: s3_key, ResponseContentType: 'video/mp4' }), { expiresIn: 12 * 3600 });
    } catch (e) { return json(502, { ok: false, error: 'sign_failed', detail: String((e && e.message) || e) }); }

    const r = await enqueueFromVideoUrl({
      videoUrl, s3_key,
      title: String(b.title || `${who.name} clip`).slice(0, 100),
      hook: b.hook, content_type: b.content_type || 'creator',
      source: 'creator', creator: who.id,
    });
    if (!r.ok) return json(502, { ok: false, error: 'enqueue_failed', detail: r.error || r.detail });
    return json(200, { ok: true, job: { id: r.job.id, status: r.job.status, title: r.job.title } });
  }

  return json(400, { ok: false, error: 'unknown_action' });
};
