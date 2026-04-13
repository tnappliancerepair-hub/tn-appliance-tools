const https = require('https');

exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const job_id = event.queryStringParameters && event.queryStringParameters.job_id;
  if (!job_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "job_id is required" }) };
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'xbtp-g9bh-ditq.n7e.xano.io',
        path: '/api:3e_TffpA/get_job?job_id=' + job_id,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        rejectUnauthorized: false
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });

      req.on('error', reject);
      req.end();
    });

    return {
      statusCode: result.status,
      headers,
      body: result.body,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
