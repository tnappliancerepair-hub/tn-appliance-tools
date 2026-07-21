// media-file — PUBLIC, stable URL for a marketing clip or its poster. STREAMS the
// S3 bytes inline with honest range support (same URL, no redirect) so <video> plays
// on iOS Safari — a 302 redirect does NOT reliably play in a video box. Prefix-locked
// to social/clips/ so only our marketing media is servable (no open SSRF). This is
// what lets us embed the recovered videos on public webpages with a permanent src.
//   GET ?key=social/clips/<file>.(mp4|jpg)   (Range honored for video)
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const CAP = 3 * 1024 * 1024; // 3MB/chunk → ~4MB base64, under the 6MB function limit

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

  // ?json=1 → return a fresh signed S3 URL. iOS Safari plays a DIRECT S3 url (native
  // range/seek) reliably, where it chokes on a proxy/redirect. The page fetches this
  // on load and sets it as the <video> src — same approach the Studio uses.
  if (q.json === '1') {
    try {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: isImg ? 'image/jpeg' : 'video/mp4', ResponseContentDisposition: 'inline' }), { expiresIn: 6 * 3600 });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify({ url }) };
    } catch (_) { return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'not found' }) }; }
  }

  // Images (posters/thumbnails) are small → serve whole.
  if (isImg) {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const buf = Buffer.from(await r.Body.transformToByteArray());
      return {
        statusCode: 200,
        headers: { 'Content-Type': /\.png$/i.test(key) ? 'image/png' : 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
        body: buf.toString('base64'), isBase64Encoded: true,
      };
    } catch (_) { return { statusCode: 404, body: 'not found' }; }
  }

  // Video → range-stream, capped per request so the browser pulls it in pieces.
  const range = event.headers.range || event.headers.Range || '';
  let start = 0, end = null;
  const m = range.match(/bytes=(\d+)-(\d*)/);
  if (m) { start = parseInt(m[1], 10) || 0; end = m[2] ? parseInt(m[2], 10) : null; }
  const reqEnd = end !== null ? Math.min(end, start + CAP - 1) : start + CAP - 1;

  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${reqEnd}` }));
    const buf = Buffer.from(await r.Body.transformToByteArray());
    let total = null;
    if (r.ContentRange) { const t = r.ContentRange.match(/\/(\d+)$/); if (t) total = parseInt(t[1], 10); }
    if (total == null && r.ContentLength != null) total = start + r.ContentLength;
    const realEnd = start + buf.length - 1;
    return {
      statusCode: 206,
      headers: {
        'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${realEnd}/${total != null ? total : realEnd + 1}`,
        'Content-Length': String(buf.length), 'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*',
      },
      body: buf.toString('base64'), isBase64Encoded: true,
    };
  } catch (_) { return { statusCode: 404, body: 'not found' }; }
};
