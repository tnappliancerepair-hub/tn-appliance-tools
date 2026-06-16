// stream-direct-upload — mint a one-time, tokenless Cloudflare Stream tus upload
// URL for the browser to push a video to (resumable — fail-proof on weak signal),
// and record the video as a job_attachments row so it auto-links to the job (by
// conversation_id) and shows in the Teddy Tool. Video only — photos stay on S3.
//
// Uses the tus creation endpoint with ?direct_user=true so the returned Location
// can be uploaded to WITHOUT exposing our API token to the browser.
//
//   POST { bytes, conversation_id?, job_id?, uploaded_by?, max_seconds?, filename? }
//   -> { ok, uploadUrl, uid, attachment_id }   |   { ok:false, fallback:true }
//
// fallback:true means Cloudflare isn't configured yet → client uses the S3 path.

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
function b64(str) { return Buffer.from(String(str), 'utf8').toString('base64'); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
  const token = await getSecret('CLOUDFLARE_STREAM_TOKEN');
  if (!acct || !token) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, fallback: true, reason: 'stream_not_configured' }) };
  }

  const bytes = parseInt(b.bytes, 10);
  if (!bytes || bytes < 1) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'bytes required' }) };

  const convId = b.conversation_id != null && String(b.conversation_id).replace(/\D/g, '') ? parseInt(String(b.conversation_id).replace(/\D/g, ''), 10) : null;
  const jobId = b.job_id != null && String(b.job_id).replace(/\D/g, '') ? parseInt(String(b.job_id).replace(/\D/g, ''), 10) : null;
  const uploadedBy = ['customer', 'tech', 'teddy'].includes(s(b.uploaded_by, 12)) ? s(b.uploaded_by, 12) : 'customer';
  const maxSeconds = Math.min(Math.max(parseInt(b.max_seconds, 10) || 360, 30), 600); // 30s–10min reserve
  const filename = s(b.filename, 120) || 'video.mp4';

  // 1. create a resumable (tus) upload; ?direct_user=true returns a tokenless one-time URL
  //    Upload-Metadata is comma-separated `key b64(value)` pairs. requiresignedurls is
  //    omitted (its presence = true), so the video is viewable by uid for our team.
  const meta = [
    'name ' + b64(filename),
    'maxDurationSeconds ' + b64(String(maxSeconds)),
  ].join(',');
  let uploadUrl, uid;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/stream?direct_user=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(bytes),
        'Upload-Metadata': meta,
      },
    });
    uid = r.headers.get('stream-media-id') || '';
    uploadUrl = r.headers.get('location') || '';
    if (!uploadUrl) {
      let detail = null; try { detail = await r.text(); } catch (_) {}
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, fallback: true, reason: 'cf_no_location', status: r.status, detail: (detail || '').slice(0, 300) }) };
    }
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, fallback: true, reason: String((e && e.message) || e) }) };
  }

  // 2. record the video as a job_attachments row (s3_key marker = cfstream:<uid>) so
  //    create_job_from_chat auto-links it by conversation_id and the viewers render
  //    the Cloudflare player.
  let attachmentId = null;
  if (uid) {
    try {
      const row = await crud.insert(JOB_ATTACHMENTS, {
        job_id: jobId,
        conversation_id: convId,
        attachment_type: 'intake',
        file_type: 'video',
        s3_key: 'cfstream:' + uid,
        original_filename: filename,
        mime_type: 'video/mp4',
        uploaded_by: uploadedBy,
        uploaded_by_user_id: 0,
      });
      attachmentId = (row && (row.id || row.attachment_id)) || null;
    } catch (_) {}
  }

  await crud.logEvent('stream_upload_minted', { uid, attachment_id: attachmentId, job_id: jobId, conversation_id: convId, uploaded_by: uploadedBy, bytes, at_ms: Date.now() });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, uploadUrl, uid, attachment_id: attachmentId }) };
};
