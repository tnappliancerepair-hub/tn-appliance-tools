// save-signature — stores the customer's on-glass sign-off for a completed job. The HCP
// step Ant was missing. Browser sends the signature PNG (base64) → we store it to S3
// server-side (reliable) + record a job_attachments row (file_type 'signature') + an
// event_log 'customer_signature' with the acknowledgment + name + timestamp (proof of
// completion for warranty + disputes). Mirrors photo-upload's proven proxy path.
//
//   POST { job_id, tech_id?, customer_name?, signature_base64, acknowledged? }
//   -> { ok, attachment_id, s3_key, signed_at }
'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crud = require('./_lib/xano/metadata-crud');

const JOB_ATTACHMENTS = 22;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const raw = String(b.signature_base64 || '');
  const data = raw.indexOf(',') >= 0 ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!data) return json(400, { ok: false, error: 'signature_base64 required' });
  let buf;
  try { buf = Buffer.from(data, 'base64'); } catch (_) { return json(400, { ok: false, error: 'bad base64' }); }
  if (!buf.length || buf.length > 4 * 1024 * 1024) return json(400, { ok: false, error: 'bad size' });

  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || null;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });
  const techId = parseInt(String(b.tech_id || '').replace(/\D/g, ''), 10) || 0;
  const customerName = String(b.customer_name || '').slice(0, 120);
  const acknowledged = b.acknowledged !== false;
  const ts = Date.now();

  // 1. S3 (server-side, reliable)
  const s3Key = `jobs/${jobId}/signature/${ts}_signature.png`;
  try {
    const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
    await s3.send(new PutObjectCommand({ Bucket: process.env.TN_AWS_S3_BUCKET, Key: s3Key, Body: buf, ContentType: 'image/png' }));
  } catch (e) { return json(502, { ok: false, error: 's3 store failed: ' + ((e && e.message) || e) }); }

  // 2. record the attachment (shows in the job's media everywhere)
  let attachmentId = null;
  try {
    const row = await crud.insert(JOB_ATTACHMENTS, {
      job_id: jobId, conversation_id: null, attachment_type: 'signoff', file_type: 'signature',
      s3_key: s3Key, original_filename: 'signature.png', mime_type: 'image/png',
      uploaded_by: 'customer', uploaded_by_user_id: techId, upload_complete_at: ts, file_size_bytes: buf.length,
    });
    attachmentId = (row && (row.id || row.attachment_id)) || null;
  } catch (_) {}

  // 3. durable proof-of-completion record
  try { await crud.logEvent('customer_signature', { job_id: jobId, tech_id: techId, customer_name: customerName, acknowledged, s3_key: s3Key, attachment_id: attachmentId, signed_at: ts }); } catch (_) {}

  return json(200, { ok: true, attachment_id: attachmentId, s3_key: s3Key, signed_at: ts });
};
