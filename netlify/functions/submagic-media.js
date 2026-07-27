// submagic-media — HEAD-able pull URL for a raw Studio clip so Submagic can ingest it.
// Submagic validates a source URL with a HEAD request first; an S3 SigV4 presigned GET
// URL returns 403 on HEAD → "The provided URL does not point to a downloadable media
// file." This answers HEAD itself (200 + video/mp4 + real size) and 302-redirects the
// GET to a fresh S3 presigned URL, so the actual bytes go Submagic -> S3 directly (no
// Netlify response-size limit). Token-authed (short-lived HMAC), not an open proxy.
//   HEAD/GET ?k=<s3_key>&e=<expiryMs>&t=<hmac>
'use strict';
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecret } = require('./_lib/secrets');
const { signToken } = require('./_lib/media-proxy');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const key = String(q.k || '');
  const exp = parseInt(q.e || '0', 10);
  const tok = String(q.t || '');
  const secret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!key || !exp || !tok) return { statusCode: 400, body: 'bad request' };
  if (Date.now() > exp) return { statusCode: 410, body: 'expired' };
  if (signToken(key, exp, secret) !== tok) return { statusCode: 403, body: 'forbidden' };

  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!bucket) return { statusCode: 500, body: 's3_not_configured' };
  const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });

  // HEAD → answer with real media headers so the validator sees a downloadable file.
  if (event.httpMethod === 'HEAD') {
    try {
      const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(h.ContentLength || 0),
          'Accept-Ranges': 'bytes',
          'Content-Disposition': 'inline; filename="clip.mp4"',
        },
        body: '',
      };
    } catch (e) { return { statusCode: 404, body: 'not_found' }; }
  }

  // GET (and any other method) → redirect to a fresh short-lived S3 presigned GET URL.
  // Submagic follows the 302 with GET and downloads straight from S3.
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: bucket, Key: key,
      ResponseContentType: 'video/mp4',
      ResponseContentDisposition: 'inline; filename="clip.mp4"',
    }), { expiresIn: 3600 });
    return { statusCode: 302, headers: { Location: url, 'Content-Type': 'video/mp4' }, body: '' };
  } catch (e) { return { statusCode: 502, body: 'sign_failed' }; }
};
