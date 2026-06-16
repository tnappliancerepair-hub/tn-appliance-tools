// images-direct-upload — mint a one-time Cloudflare Images upload URL for the
// browser to push a photo to (Cloudflare's reliable infra + global CDN), and
// record it as a job_attachments row so it auto-links to the job (by
// conversation_id) and shows in EVERY tool (Teddy Tool / tech / office / portal).
//
//   POST { conversation_id?, job_id?, uploaded_by? }
//   -> { ok, uploadURL, id, deliveryUrl, attachment_id }   |   { ok:false, fallback:true }
//
// fallback:true => Images not configured yet → client uses the S3 path.
// Reuses the Stream token if a dedicated Images token isn't set (just add
// "Cloudflare Images: Edit" to the same token).

'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const JOB_ATTACHMENTS = 22;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function s(v, max) { return String(v == null ? '' : v).slice(0, max || 200); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
  const token = (await getSecret('CLOUDFLARE_IMAGES_TOKEN')) || (await getSecret('CLOUDFLARE_STREAM_TOKEN'));
  const hash = await getSecret('CLOUDFLARE_IMAGES_HASH');
  if (!acct || !token || !hash) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, fallback: true, reason: 'images_not_configured' }) };
  }

  const convId = b.conversation_id != null && String(b.conversation_id).replace(/\D/g, '') ? parseInt(String(b.conversation_id).replace(/\D/g, ''), 10) : null;
  const jobId = b.job_id != null && String(b.job_id).replace(/\D/g, '') ? parseInt(String(b.job_id).replace(/\D/g, ''), 10) : null;
  const uploadedBy = ['customer', 'tech', 'teddy'].includes(s(b.uploaded_by, 12)) ? s(b.uploaded_by, 12) : 'customer';

  // 1. ask Cloudflare Images for a one-time upload URL (public delivery, no signed URLs)
  let uploadURL, id;
  try {
    const form = new URLSearchParams();
    form.set('requireSignedURLs', 'false');
    form.set('metadata', JSON.stringify({ job_id: jobId || '', conversation_id: convId || '', uploaded_by: uploadedBy, source: 'ant' }));
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/images/v2/direct_upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const d = await r.json().catch(() => ({}));
    if (!d || !d.success || !d.result || !d.result.uploadURL) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, fallback: true, reason: 'cf_error', detail: (d && d.errors) || null }) };
    }
    uploadURL = d.result.uploadURL;
    id = d.result.id;
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, fallback: true, reason: String((e && e.message) || e) }) };
  }

  // 2. record the photo as a job_attachments row. s3_key holds the full public
  //    delivery URL behind a cfimg: marker so every viewer renders it directly.
  const deliveryUrl = `https://imagedelivery.net/${hash}/${id}/public`;
  let attachmentId = null;
  try {
    const row = await crud.insert(JOB_ATTACHMENTS, {
      job_id: jobId,
      conversation_id: convId,
      attachment_type: 'intake',
      file_type: 'photo',
      s3_key: 'cfimg:' + deliveryUrl,
      original_filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      uploaded_by: uploadedBy,
      uploaded_by_user_id: 0,
      upload_complete_at: Date.now(),
      file_size_bytes: 0,
    });
    attachmentId = (row && (row.id || row.attachment_id)) || null;
  } catch (_) {}

  await crud.logEvent('image_upload_minted', { image_id: id, attachment_id: attachmentId, job_id: jobId, conversation_id: convId, uploaded_by: uploadedBy, at_ms: Date.now() });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, uploadURL, id, deliveryUrl, attachment_id: attachmentId }) };
};
