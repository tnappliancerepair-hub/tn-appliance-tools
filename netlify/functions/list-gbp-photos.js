// list-gbp-photos — owner-gated. Returns the recent GBP photos techs have
// uploaded (tagged via gbp-photo-log), each with a signed view/download URL, so
// the review gallery can show them and Teddy can grab them for the GBP profile.
//
//   GET ?secret=<admin>[&days=30][&max=60]
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const EVENT_LOG = 3;
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const days = Math.min(parseInt(q.days, 10) || 30, 120);
  const max = Math.min(parseInt(q.max, 10) || 60, 120);
  const since = Date.now() - days * 86400000;

  let rows = [];
  try {
    rows = await crud.searchPage(EVENT_LOG, { action: 'gbp_photo' }, { id: 'desc' }, max) || [];
  } catch (e) {
    return json(200, { ok: false, error: 'lookup failed: ' + String((e && e.message) || e) });
  }

  const s3 = new S3Client({
    region: process.env.TN_AWS_S3_REGION,
    credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY },
  });
  const bucket = process.env.TN_AWS_S3_BUCKET;

  const photos = [];
  for (const r of rows) {
    let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    const key = m && m.s3_key;
    if (!key || (m.at_ms && m.at_ms < since)) continue;
    let url = '';
    try { url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 }); } catch (_) {}
    photos.push({ s3_key: key, view_url: url, tech_id: m.tech_id || null, at_ms: m.at_ms || null });
  }

  return json(200, { ok: true, count: photos.length, photos });
};
