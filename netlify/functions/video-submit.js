// video-submit — the single-clip "enhance" trigger. Takes a raw tripod clip already
// uploaded to S3 (via s3-presign PUT), signs a pull URL, and fires a Submagic
// caption/hook/reframe job via the shared queue helper. Owner-gated.
//
//   POST { secret, s3_key, title, hook?, template?, content_type?, language? }
//     -> { ok, job }
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecret } = require('./_lib/secrets');
const submagic = require('./_lib/submagic');
const { enqueueFromVideoUrl } = require('./_lib/video-queue');

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

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

  let videoUrl;
  try {
    const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
    videoUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: s3_key, ResponseContentType: 'video/mp4' }), { expiresIn: 6 * 3600 });
  } catch (e) { return json(502, { error: 'sign_failed', detail: String((e && e.message) || e) }); }

  const r = await enqueueFromVideoUrl({
    videoUrl, s3_key, title: b.title, hook: b.hook, template: (String(b.template || '').slice(0, 40) || undefined),
    content_type: b.content_type, language: b.language, source: 'upload',
  });
  if (!r.ok) return json(502, { error: 'submagic_create_failed', detail: r.error || r.detail });
  return json(200, { ok: true, job: { id: r.job.id, submagic_id: r.job.submagic_id, status: r.job.status, title: r.job.title } });
};
