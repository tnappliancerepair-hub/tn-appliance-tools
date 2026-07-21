// fb-thumb-host — one-shot: pull a Facebook video's preferred thumbnail and host
// it on our S3 as a stable poster (social/clips/poster-<id>.jpg) so we can use it
// as a <video poster> + VideoObject thumbnailUrl on public pages. Owner-gated.
//   GET/POST ?secret=<admin>&video_id=<fb_video_id>
'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSecret } = require('./_lib/secrets');
const { graphGet } = require('./_lib/social-fb');
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if ((q.secret || b.secret) !== admin) return json(401, { error: 'unauthorized' });
  const vid = String(q.video_id || b.video_id || '').trim();
  if (!vid) return json(400, { error: 'video_id required' });

  const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  const r = await graphGet('/' + vid, { access_token: token, fields: 'thumbnails{uri,is_preferred},picture' });
  if (!r.ok) return json(502, { error: 'fb_thumb_failed', detail: (r.data && r.data.error && r.data.error.message) || r.status });
  const thumbs = (r.data && r.data.thumbnails && r.data.thumbnails.data) || [];
  const preferred = thumbs.find((t) => t.is_preferred) || thumbs[0];
  const uri = (preferred && preferred.uri) || (r.data && r.data.picture);
  if (!uri) return json(404, { error: 'no_thumbnail' });

  const resp = await fetch(uri);
  if (!resp.ok) return json(502, { error: 'thumb_download_failed' });
  const buf = Buffer.from(await resp.arrayBuffer());
  const bucket = process.env.TN_AWS_S3_BUCKET;
  const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
  const key = 'social/clips/poster-' + vid + '.jpg';
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: 'image/jpeg' }));
  return json(200, { ok: true, key, public_url: 'https://tnapplianceexchange.net/.netlify/functions/media-file?key=' + encodeURIComponent(key) });
};
