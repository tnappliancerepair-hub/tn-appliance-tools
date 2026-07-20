// inbound-media — shared MMS media capture for inbound customer texts, used by
// BOTH lines (customer-sms-inbound = AI line, human-line-inbound = human line).
// A customer texts a photo/video → we fetch the (temporary) Telnyx/Twilio media
// URL, re-host the bytes to S3, insert a job_attachments row, AND log a
// `customer_sms_media_captured` event with the s3 keys. sms-thread returns that
// event so the pics render INLINE in the conversation (office board + tech page).
'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crud = require('./xano/metadata-crud');

const JOB_ATTACHMENTS = 22;
const MEDIA_FETCH_TIMEOUT_MS = 6000;
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Resolve the customer's CURRENT job from their phone, so texted media attaches
// to the right job → auto-shows on the job tile (no manual add for the office).
// Prefers an open job, falls back to the most-recent. Best-effort → 0 if none.
async function resolveJobIdByPhone(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  if (!p) return 0;
  try {
    const lk = await fetch(XANO + '/lookup_customer_by_phone?phone=' + encodeURIComponent(p), { signal: AbortSignal.timeout(6000) }).then((r) => r.json());
    const j = (lk && ((lk.open_jobs && lk.open_jobs[0]) || (lk.recent_jobs && lk.recent_jobs[0]))) || null;
    return Number(j && (j.id || j.job_id)) || 0;
  } catch (_) { return 0; }
}

function fileTypeFor(mime) { const m = String(mime || '').toLowerCase(); if (m.startsWith('image/')) return 'photo'; if (m.startsWith('video/')) return 'video'; return 'file'; }
function extFor(mime) {
  const m = String(mime || '').toLowerCase();
  const map = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/webm': 'webm', 'video/x-m4v': 'm4v' };
  return map[m] || (m.startsWith('image/') ? 'jpg' : m.startsWith('video/') ? 'mp4' : 'bin');
}

async function captureOneMedia({ url, contentType, jobId, convId, fromPhone, idx, tag }) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), MEDIA_FETCH_TIMEOUT_MS);
  let buf, mime = contentType;
  try {
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(tm);
    if (!r.ok) { console.warn('[' + tag + '] media fetch non-2xx', r.status); return null; }
    mime = mime || r.headers.get('content-type') || 'application/octet-stream';
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) { clearTimeout(tm); console.warn('[' + tag + '] media fetch error', String((e && e.message) || e)); return null; }
  if (!buf || !buf.length || buf.length > 25 * 1024 * 1024) return null;

  const ext = extFor(mime), ftype = fileTypeFor(mime), ts = Date.now();
  const folder = jobId ? ('jobs/' + jobId) : ('sms/' + String(fromPhone || 'anon').replace(/\D/g, ''));
  const s3Key = folder + '/sms/' + ts + '_' + idx + '.' + ext;

  try {
    const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
    await s3.send(new PutObjectCommand({ Bucket: process.env.TN_AWS_S3_BUCKET, Key: s3Key, Body: buf, ContentType: mime }));
  } catch (e) { console.warn('[' + tag + '] media s3 store failed', String((e && e.message) || e)); return null; }

  try {
    await crud.insert(JOB_ATTACHMENTS, {
      job_id: jobId || null, conversation_id: convId || null, attachment_type: 'intake',
      file_type: ftype, s3_key: s3Key, original_filename: 'sms_' + ftype + '.' + ext, mime_type: mime,
      uploaded_by: 'customer', uploaded_by_user_id: 0, upload_complete_at: ts, file_size_bytes: buf.length,
    });
  } catch (e) { console.warn('[' + tag + '] media attachment insert failed', String((e && e.message) || e)); }
  return { s3Key, file_type: ftype, bytes: buf.length };
}

// media = [{url, content_type}]. jobId optional (null = keyed to phone; the thread
// matches media events by the customer phone anyway). Returns [{s3Key,...}].
async function captureInboundMedia({ media, jobId, convId, fromPhone, tag }) {
  if (!Array.isArray(media) || !media.length) return [];
  const out = [];
  for (let i = 0; i < media.length && i < 5; i++) {
    const m = media[i] || {};
    if (!m.url) continue;
    const res = await captureOneMedia({ url: m.url, contentType: m.content_type || m.contentType, jobId, convId, fromPhone, idx: i, tag: tag || 'inbound-media' });
    if (res) out.push(res);
  }
  try { await crud.logEvent('customer_sms_media_captured', { job_id: jobId || null, from: fromPhone, count: out.length, keys: out.map((o) => o.s3Key), at_ms: Date.now() }); } catch (_) {}
  return out;
}

module.exports = { captureInboundMedia, captureOneMedia, resolveJobIdByPhone };
