const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

exports.config = {
  timeout: 10
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    if (!body.s3_key || !body.mime_type) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing s3_key or mime_type" })
      };
    }

    const s3Client = new S3Client({
      region: process.env.AWS_S3_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: body.s3_key,
      ContentType: body.mime_type
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 900
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        upload_url: uploadUrl,
        expires_in: 900
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
