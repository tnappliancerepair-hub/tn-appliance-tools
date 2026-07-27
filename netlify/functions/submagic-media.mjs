// submagic-media — streams a raw Studio clip from S3 so Submagic/Vizard can ingest it.
//
// WHY a proxy: Submagic validates a source URL with a HEAD request first, and an S3
// SigV4 *presigned GET* URL returns 403 on HEAD (the method is part of the signature)
// -> Submagic rejects it as "not a downloadable media file." Netlify's CDN converts
// HEAD->GET and strips the body, so if we serve the real bytes on GET, the HEAD probe
// sees a 200 + video/mp4 (body stripped) and passes, and the actual GET downloads the
// file. A v2 *streaming* response is required — the raw clip (tens of MB) exceeds the
// 6MB buffered-response cap of a normal function. Token-authed (short-lived HMAC bound
// to key+expiry) so it isn't an open proxy to the whole bucket. Range is honored.
//   GET ?k=<s3_key>&e=<expiryMs>&t=<hmac>
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import secretsLib from './_lib/secrets.js';

const { getSecret } = secretsLib;

function sign(key, expMs, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(key) + '|' + String(expMs)).digest('hex').slice(0, 32);
}

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('k') || '';
  const exp = parseInt(url.searchParams.get('e') || '0', 10);
  const tok = url.searchParams.get('t') || '';
  // Same resolution as the signer (video-submit): getSecret is env-first then vault.
  const secret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!key || !exp || !tok) return new Response('bad request', { status: 400 });
  if (Date.now() > exp) return new Response('expired', { status: 410 });
  if (sign(key, exp, secret) !== tok) return new Response('forbidden', { status: 403 });

  const bucket = process.env.TN_AWS_S3_BUCKET;
  if (!bucket) return new Response('s3_not_configured', { status: 500 });
  const s3 = new S3Client({
    region: process.env.TN_AWS_S3_REGION,
    credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY },
  });

  const range = req.headers.get('range') || undefined;
  let obj;
  try {
    obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
  } catch (e) {
    return new Response('not_found', { status: 404 });
  }

  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': 'inline; filename="clip.mp4"',
    'Cache-Control': 'private, max-age=3600',
  };
  if (obj.ContentLength != null) headers['Content-Length'] = String(obj.ContentLength);
  let status = 200;
  if (obj.ContentRange) { headers['Content-Range'] = obj.ContentRange; status = 206; }

  // obj.Body is a Node Readable in the Lambda runtime; hand Netlify a web stream.
  return new Response(Readable.toWeb(obj.Body), { status, headers });
};
