const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

exports.config = {
  timeout: 10
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    if (!body.s3_key || !body.mime_type) {
      return {
        statusCode: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing s3_key or mime_type" })
      };
    }

    const s3Client = new S3Client({
      region: process.env.TN_AWS_S3_REGION,
      credentials: {
        accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY
      },
      // AWS SDK v3 otherwise bakes a default crc32 checksum of the EMPTY command
      // body into the presigned URL -> every real file PUT fails the checksum and
      // the upload silently dies. WHEN_REQUIRED keeps PutObject checksum-free so a
      // plain browser PUT of the file works.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED"
    });

    const command = new PutObjectCommand({
      Bucket: process.env.TN_AWS_S3_BUCKET,
      Key: body.s3_key,
      ContentType: body.mime_type
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 900
    });

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        upload_url: uploadUrl,
        expires_in: 900
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
