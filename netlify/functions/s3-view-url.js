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
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: s3_key,
        });
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
