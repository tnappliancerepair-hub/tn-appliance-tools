// transcode-legacy-videos — upgrade already-stored customer MMS videos that iPhone
// can't play (mainly .3gp / video/3gpp from older Android phones) into Cloudflare
// Stream, so the tech/office renderers show a poster + playable HLS instead of a
// black box (David Derocher job 21261, Teddy 2026-08-14).
//
// For each targeted video attachment: resolve a signed S3 URL, tell Stream to
// fetch+transcode it (copy), then flip the attachment's s3_key to cfstream:<uid>.
// The raw S3 object stays as a durable backup. Idempotent — cfstream keys are skipped.
//
//   GET ?secret=<admin>&job_id=21261        upgrade a job's legacy videos (dry unless &go=1)
//   GET ?secret=<admin>&job_id=21261&go=1   actually transcode + rewrite the keys
//   &all=1                                   also include mp4/mov (default: only non-iOS containers)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const streamIngest = require('./_lib/stream-ingest');
const { getSecret } = require('./_lib/secrets');

const JOB_ATTACHMENTS = 22;
const SITE = 'https://tnapplianceexchange.net';
// Containers iPhone Safari can't reliably play inline → always worth transcoding.
const NON_IOS = /\.(3gp|3g2|webm|avi|mkv|flv|wmv|mpg|mpeg|ogv)$/i;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function signedUrl(s3Key) {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/s3-view-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s3_keys: [s3Key] }), signal: AbortSignal.timeout(10000) });
    const d = await r.json().catch(() => ({}));
    return ((d && d.signed_urls) || [])[0]?.view_url || '';
  } catch (_) { return ''; }
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });
  const jobId = parseInt(q.job_id || 0, 10);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  const go = q.go === '1';
  const includeAll = q.all === '1';

  let atts = [];
  try { atts = await crud.searchPage(JOB_ATTACHMENTS, { job_id: jobId }, { id: 'asc' }, 100); } catch (e) { return j(200, { ok: false, error: 'list failed: ' + String((e && e.message) || e) }); }

  const targets = atts.filter((a) => {
    const sk = String(a.s3_key || '');
    if (!sk || sk.startsWith('cfstream:') || sk.startsWith('cfimg:')) return false;   // already streamable / image
    const isVid = a.file_type === 'video' || /\.(mp4|mov|3gp|3g2|webm|avi|mkv|m4v)$/i.test(sk) || String(a.mime_type || '').startsWith('video/');
    if (!isVid) return false;
    return includeAll ? true : NON_IOS.test(sk);
  });

  if (!go) return j(200, { ok: true, dry: true, job_id: jobId, total_attachments: atts.length, would_transcode: targets.map((a) => ({ id: a.id, s3_key: a.s3_key, mime: a.mime_type })) });

  const results = [];
  for (const a of targets) {
    const url = await signedUrl(a.s3_key);
    if (!url) { results.push({ id: a.id, ok: false, why: 'no_signed_url' }); continue; }
    const uid = await streamIngest.copyFromUrl(url, { job_id: jobId, from_attachment: a.id, name: 'legacy_' + a.id });
    if (!uid) { results.push({ id: a.id, ok: false, why: 'stream_copy_failed' }); continue; }
    try {
      await crud.update(JOB_ATTACHMENTS, a.id, { s3_key: 'cfstream:' + uid });
      try { await crud.logEvent('legacy_video_transcoded', { job_id: jobId, attachment_id: a.id, uid, old_key: a.s3_key, at_ms: Date.now() }); } catch (_) {}
      results.push({ id: a.id, ok: true, uid });
    } catch (e) { results.push({ id: a.id, ok: false, why: 'update_failed: ' + String((e && e.message) || e).slice(0, 80), uid }); }
  }

  return j(200, { ok: true, job_id: jobId, transcoded: results.filter((r) => r.ok).length, results, note: 'Stream is transcoding — thumbnails appear in ~30-90s; tech taps ↻ refresh.' });
};
