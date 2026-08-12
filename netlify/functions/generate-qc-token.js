// QC token generator. Mints HMAC-SHA256 signed tokens for the cash flow
// QC pipeline customer-facing TDR view links. Called by Xano's
// send_qc_diagnosis_to_customer endpoint over an internal-auth-protected POST.
//
// XanoScript has no native HMAC primitive, so token signing lives here.
// Mirrors hcp-webhook-proxy.js architecture: Netlify holds the cryptographic
// capability that Xano can't natively express.
//
// Token format: base64url(json_payload).hmac_sha256_signature
// Payload: { job_id, tdr_id, expiry_unix, v: 1 }
//
// Companion validator: validate-qc-token.js

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
    console.error('[generate-qc-token] env vars not configured');
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
  const tdrId = body.tdr_id;
  let expirySeconds = typeof body.expiry_seconds === 'number' ? body.expiry_seconds : 604800;

  // Durable customer links (Teddy 2026-08-11): "we don't want the link to expire
  // so people can think about what they want to do." Any real customer send (the
  // XS asks for >= 1 day) becomes effectively non-expiring so the TDR options link
  // stays alive for days/weeks while the customer decides. The payment link never
  // goes stale either: the Stripe checkout session is minted fresh when they click
  // Confirm and Pay, so a durable TDR link keeps the whole flow reachable.
  // Short-lived preview tokens (< 1 day, e.g. the 30-min Teddy preview) stay short.
  const DURABLE_FLOOR_SECONDS = 315360000; // ~10 years
  if (expirySeconds >= 86400) {
    expirySeconds = DURABLE_FLOOR_SECONDS;
  }

  if (typeof jobId !== 'number' || typeof tdrId !== 'number') {
    return json(400, { error: 'job_id and tdr_id (numbers) required' });
  }

  const expiryUnix = Math.floor(Date.now() / 1000) + expirySeconds;
  const payload = { job_id: jobId, tdr_id: tdrId, expiry_unix: expiryUnix, v: 1 };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret).update(payloadB64, 'utf8').digest('hex');
  const token = payloadB64 + '.' + signature;

  // Short branded link (Teddy 2026-08-11 SMS-cost): /t/<jobId>-<tdrId>-<sig>.
  // sig is a 10-hex HMAC over "sl:<jobId>-<tdrId>" so the code is unguessable but
  // needs no storage; the shortlink fn re-mints a fresh durable token on click.
  const SITE = 'https://tnapplianceexchange.net';
  const shortSig = crypto.createHmac('sha256', tokenSecret).update(`sl:${jobId}-${tdrId}`, 'utf8').digest('hex').slice(0, 10);
  // Readable /quote/ prefix so the SMS link is understandable to the customer
  // (their repair quote), not a cryptic /t/ code.
  const shortUrl = `${SITE}/quote/${jobId}-${tdrId}-${shortSig}`;

  return json(200, {
    token,
    short_url: shortUrl,
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
