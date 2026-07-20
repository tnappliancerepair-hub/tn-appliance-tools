// sms-media — view a customer-texted photo/video by its stored key. Resolves the
// S3 key to a short-lived signed URL and 302-redirects. Lets the conversation
// thread render pics inline with a plain <img src="/.netlify/functions/sms-media?key=…">,
// no client-side URL juggling. Cloudflare-hosted keys pass straight through.
//   GET ?key=<s3_key | cfimg:<url> | cfstream:<uid>>
'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function redirect(url) { return { statusCode: 302, headers: { Location: url, 'cache-control': 'private, max-age=600' }, body: '' }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const key = q.key || '';
  if (!key) return { statusCode: 400, body: 'key required' };
  if (key.startsWith('cfimg:')) return redirect(key.slice(6));
  if (key.startsWith('cfstream:')) return redirect('https://iframe.cloudflarestream.com/' + key.slice(9));
  try {
    const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.TN_AWS_S3_BUCKET, Key: key, ResponseContentDisposition: 'inline' }), { expiresIn: 900 });
    return redirect(url);
  } catch (e) { return { statusCode: 404, body: 'not found' }; }
};
