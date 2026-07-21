// media-file — PUBLIC, stable URL for a marketing clip or its poster. Redirects to
// a fresh signed S3 URL so the browser streams/seeks natively (no Lambda size cap).
// Prefix-locked to social/clips/ so only our marketing media is servable. This is
// what lets us embed the recovered videos on public webpages with a permanent src.
//   GET ?key=social/clips/<file>.(mp4|jpg)
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const key = String(q.key || '');
  if (!key || key.indexOf('social/clips/') !== 0 || key.indexOf('..') >= 0) {
    return { statusCode: 400, body: 'bad key' };
  }
  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!bucket) return { statusCode: 500, body: 'no bucket' };
  const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
  const isImg = /\.(jpg|jpeg|png)$/i.test(key);
  const ct = isImg ? (/\.png$/i.test(key) ? 'image/png' : 'image/jpeg') : 'video/mp4';
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: ct, ResponseContentDisposition: 'inline' }), { expiresIn: 6 * 3600 });
    return { statusCode: 302, headers: { Location: url, 'Cache-Control': 'public, max-age=1800' }, body: '' };
  } catch (e) {
    return { statusCode: 404, body: 'not found' };
  }
};
