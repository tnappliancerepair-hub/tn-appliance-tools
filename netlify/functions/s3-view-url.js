const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: process.env.TN_AWS_S3_REGION,
  credentials: {
    accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY,
  },
});

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { s3_keys } = body;

    if (!s3_keys || !Array.isArray(s3_keys) || s3_keys.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "s3_keys array is required" }),
      };
    }

    const bucket = process.env.TN_AWS_S3_BUCKET;

    const signed_urls = await Promise.all(
      s3_keys.map(async (s3_key) => {
        // Cloudflare-hosted media: the key already carries the public URL.
        // cfimg:<delivery-url> → photo URL; cfstream:<uid> → Stream player URL.
        // This makes Cloudflare photos render in EVERY tool that uses this signer.
        const key = String(s3_key || '');
        if (key.indexOf('cfimg:') === 0) {
          return { s3_key, view_url: key.slice(6), kind: 'image' };
        }
        if (key.indexOf('cfstream:') === 0) {
          const uid = key.slice(9);
          return { s3_key, view_url: 'https://iframe.cloudflarestream.com/' + uid, stream_uid: uid, kind: 'video_stream' };
        }
        // Force inline disposition + sane Content-Type for video files
        // so Safari plays inline instead of treating it like a download
        // (which manifests as the "play button with a line through it"
        // unsupported-media icon).
        const k = String(s3_key || '').toLowerCase();
        const isMp4 = k.endsWith('.mp4');
        const isMov = k.endsWith('.mov');
        const isJpg = k.endsWith('.jpg') || k.endsWith('.jpeg');
        const isPng = k.endsWith('.png');
        const params = { Bucket: bucket, Key: s3_key, ResponseContentDisposition: 'inline' };
        if (isMp4) params.ResponseContentType = 'video/mp4';
        else if (isMov) params.ResponseContentType = 'video/quicktime';
        else if (isJpg) params.ResponseContentType = 'image/jpeg';
        else if (isPng) params.ResponseContentType = 'image/png';
        const command = new GetObjectCommand(params);
        const url = await getSignedUrl(s3, command, { expiresIn: 900 });
        return { s3_key, view_url: url };
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        signed_urls: signed_urls,
        expires_in: 900,
      }),
    };
  } catch (err) {
    console.error("s3-view-url error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
