// Chat-link token generator. Mints HMAC-SHA256 signed tokens that embed in
// customer-facing chat URLs (https://tnapplianceexchange.net/chat?token=...).
// Called by Xano's ahs_email_intake (and future intake endpoints that need
// to mint a chat link) over an internal-auth-protected POST.
//
// XanoScript has no native HMAC primitive, so token signing lives here.
// Mirrors generate-qc-token.js architecture: Netlify holds the cryptographic
// capability that Xano can't natively express. Distinct surface area from
// generate-qc-token because the payload shape (job_id only, no tdr_id) and
// the secret rotation cadence are independent.
//
// Token format: base64url(json_payload).hmac_sha256_signature
// Payload: { job_id, expiry_unix, v: 1 }
//
// Validation: a companion validator endpoint will live in Xano (consuming
// CHAT_TOKEN_SECRET via a separate Netlify function or via inline HMAC
// once that primitive lands). For now, the token is opaque to Xano —
// only this function knows how to sign it.

const crypto = require('crypto');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return cors(200, '');
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method not allowed' });
  }

  const internalAuth = process.env.HCP_INTERNAL_AUTH_SECRET;
  const tokenSecret = process.env.CHAT_TOKEN_SECRET;
  if (!internalAuth || !tokenSecret) {
    console.error('[sign-job-token] env vars not configured');
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

  const jobId = body.job_id;
  const expirySeconds = typeof body.expiry_seconds === 'number' ? body.expiry_seconds : 604800;

  if (typeof jobId !== 'number' || !Number.isFinite(jobId) || jobId <= 0) {
    return json(400, { error: 'job_id (positive number) required' });
  }

  const expiryUnix = Math.floor(Date.now() / 1000) + expirySeconds;
  const payload = { job_id: jobId, expiry_unix: expiryUnix, v: 1 };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret).update(payloadB64, 'utf8').digest('hex');
  const token = payloadB64 + '.' + signature;

  return json(200, {
    token,
    expires_at: new Date(expiryUnix * 1000).toISOString(),
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
