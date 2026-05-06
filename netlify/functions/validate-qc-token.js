// QC token validator. Verifies HMAC-SHA256 signed tokens from
// generate-qc-token.js. Called by Xano's qc_diagnosis_view endpoint.
//
// Returns { valid: true, job_id, tdr_id, expires_at } on success, or
// { valid: false, reason: "..." } on failure. The "consumed" check
// (TDR already confirmed) lives in Xano, NOT here — this function only
// validates signature + expiry.

const crypto = require('crypto');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return cors(200, '');
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method not allowed' });
  }

  const internalAuth = process.env.HCP_INTERNAL_AUTH_SECRET;
  const tokenSecret = process.env.QC_TOKEN_SECRET;
  if (!internalAuth || !tokenSecret) {
    console.error('[validate-qc-token] env vars not configured');
    return json(500, { error: 'server misconfigured' });
  }

  const providedAuth =
    event.headers['x-internal-auth'] ||
    event.headers['X-Internal-Auth'] || '';
  if (!timingSafeStringEqual(providedAuth, internalAuth)) {
    return json(401, { error: 'unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return json(400, { error: 'invalid json body' });
  }

  const token = body.token;
  if (typeof token !== 'string' || token === '') {
    return json(200, { valid: false, reason: 'malformed' });
  }

  // Split on the last dot. Payload is base64url which never contains dots,
  // but we use lastIndexOf defensively in case of future format changes.
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) {
    return json(200, { valid: false, reason: 'malformed' });
  }
  const payloadB64 = token.slice(0, lastDot);
  const providedSig = token.slice(lastDot + 1);
  if (!payloadB64 || !providedSig) {
    return json(200, { valid: false, reason: 'malformed' });
  }

  const expectedSig = crypto.createHmac('sha256', tokenSecret).update(payloadB64, 'utf8').digest('hex');
  if (!timingSafeStringEqual(providedSig, expectedSig)) {
    return json(200, { valid: false, reason: 'invalid_signature' });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_e) {
    return json(200, { valid: false, reason: 'malformed' });
  }

  if (
    typeof payload.expiry_unix !== 'number' ||
    typeof payload.job_id !== 'number' ||
    typeof payload.tdr_id !== 'number'
  ) {
    return json(200, { valid: false, reason: 'malformed' });
  }

  if (Math.floor(Date.now() / 1000) >= payload.expiry_unix) {
    return json(200, { valid: false, reason: 'expired' });
  }

  return json(200, {
    valid: true,
    job_id: payload.job_id,
    tdr_id: payload.tdr_id,
    expires_at: new Date(payload.expiry_unix * 1000).toISOString(),
  });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function cors(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Auth',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body,
  };
}

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (_e) {
    return false;
  }
}
