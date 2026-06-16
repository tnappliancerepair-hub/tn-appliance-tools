// photo-upload — reliable photo intake that routes AROUND the flaky browser→S3
// direct PUT. The browser sends a small downscaled JPEG to THIS function (the
// same browser→Netlify hop that the payment call uses and that always works on
// weak signal/iOS), and we store it to S3 server-side (rock solid) + record the
// job_attachments row so it auto-links by conversation_id and shows everywhere.
//
//   POST { image_base64, conversation_id?, job_id?, uploaded_by? }
//   -> { ok, attachment_id, s3_key }

'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crud = require('./_lib/xano/metadata-crud');

const JOB_ATTACHMENTS = 22;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const raw = String(b.image_base64 || '');
  const data = raw.indexOf(',') >= 0 ? raw.slice(raw.indexOf(',') + 1) : raw; // strip data: prefix
  if (!data) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'image_base64 required' }) };
  let buf;
  try { buf = Buffer.from(data, 'base64'); } catch (_) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'bad base64' }) }; }
  if (!buf.length || buf.length > 12 * 1024 * 1024) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'bad size' }) };

  const convId = b.conversation_id != null && String(b.conversation_id).replace(/\D/g, '') ? parseInt(String(b.conversation_id).replace(/\D/g, ''), 10) : null;
  const jobId = b.job_id != null && String(b.job_id).replace(/\D/g, '') ? parseInt(String(b.job_id).replace(/\D/g, ''), 10) : null;
  const uploadedBy = ['customer', 'tech', 'teddy'].includes(String(b.uploaded_by)) ? String(b.uploaded_by) : 'customer';

  // 1. store to S3 server-side (reliable — no browser CORS/checksum/preflight issues)
  const bucket = process.env.TN_AWS_S3_BUCKET;
  const ts = Date.now();
  const folder = jobId ? ('jobs/' + jobId) : ('chat/' + (convId || 'anon'));
  const s3Key = folder + '/intake/' + ts + '_photo.jpg';
  try {
    const s3 = new S3Client({
      region: process.env.TN_AWS_S3_REGION,
      credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY },
    });
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: buf, ContentType: 'image/jpeg' }));
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: 's3 store failed: ' + ((e && e.message) || e) }) };
  }

  // 2. record the attachment so it auto-links by conversation_id + shows everywhere
  let attachmentId = null;
  try {
    const row = await crud.insert(JOB_ATTACHMENTS, {
      job_id: jobId,
      conversation_id: convId,
      attachment_type: 'intake',
      file_type: 'photo',
      s3_key: s3Key,
      original_filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      uploaded_by: uploadedBy,
      uploaded_by_user_id: 0,
      upload_complete_at: ts,
      file_size_bytes: buf.length,
    });
    attachmentId = (row && (row.id || row.attachment_id)) || null;
  } catch (_) {}

  await crud.logEvent('photo_upload_proxied', { attachment_id: attachmentId, job_id: jobId, conversation_id: convId, bytes: buf.length, uploaded_by: uploadedBy, at_ms: ts });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, attachment_id: attachmentId, s3_key: s3Key }) };
};
