// HCP webhook proxy.
//
// Receives webhook deliveries from Housecall Pro, verifies the HMAC-SHA256
// signature against the raw request body using HCP_WEBHOOK_SECRET, and
// forwards verified requests to the Xano hcp_job_webhook endpoint.
//
// This sidesteps a Xano platform limitation: Xano's util.get_raw_input only
// returns parsed JSON (not raw bytes), which prevents byte-faithful HMAC
// verification from inside XanoScript. Doing it here in Node where
// event.body is the literal raw body Netlify received gives correct results.
//
// Architecture:
//   HCP -> this function (HMAC verify) -> Xano hcp_job_webhook -> existing handler
//
// Gating: SIGNATURE_VERIFICATION_ENABLED env var. When "false" (default), the
// function logs received vs computed signatures and forwards regardless of
// match. This lets us observe real HCP signature shapes before flipping to
// strict enforcement. When "true", mismatches return 401 and never reach Xano.
//
// Internal auth: a shared secret HCP_INTERNAL_AUTH_SECRET is forwarded to
// Xano in BOTH an X-Internal-Auth header AND a _internal_auth body field.
// Xano reads from the body field today (XanoScript can't reliably read
// arbitrary HTTP headers in text format yet); the header is forwarded for
// future use when Xano gains that capability.

const crypto = require('crypto');

const XANO_DEFAULT_URL = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_job_webhook';

exports.handler = async function (event, context) {
  // CORS preflight (HCP doesn't issue OPTIONS, but other tooling might).
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, x-housecallpro-signature, X-HousecallPro-Signature',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Required env vars.
  const secret = process.env.HCP_WEBHOOK_SECRET;
  const internalAuth = process.env.HCP_INTERNAL_AUTH_SECRET;
  const verificationEnabled = (process.env.SIGNATURE_VERIFICATION_ENABLED || 'false').toLowerCase() === 'true';
  const xanoUrl = process.env.XANO_HCP_WEBHOOK_URL || XANO_DEFAULT_URL;

  if (!secret) {
    console.error('[hcp-webhook-proxy] HCP_WEBHOOK_SECRET not configured');
    return { statusCode: 500, body: JSON.stringify({ error: 'webhook misconfigured' }) };
  }
  if (!internalAuth) {
    console.error('[hcp-webhook-proxy] HCP_INTERNAL_AUTH_SECRET not configured');
    return { statusCode: 500, body: JSON.stringify({ error: 'webhook misconfigured' }) };
  }

  const rawBody = event.body || '';

  // Header lookup is case-insensitive in Netlify's normalized event.headers,
  // but we check both common spellings defensively.
  const sigHeader =
    event.headers['x-housecallpro-signature'] ||
    event.headers['X-HousecallPro-Signature'] ||
    event.headers['X-Housecallpro-Signature'] ||
    null;

  // Test-ping bypass. HCP fires {"foo":"bar"} when the operator clicks
  // "Test webhook" or saves a new webhook config. Test pings appear to NOT
  // be signed - we'll confirm with the first real save's diagnostic log.
  // If a signature header IS present on a test-shape body, we still verify.
  let isTestPing = false;
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && Object.keys(parsed).length === 1 && parsed.foo === 'bar') {
      isTestPing = true;
    }
  } catch (_e) {
    // Not JSON. Not a test ping. Fall through to normal verification.
  }

  // Compute expected signature regardless of branch - we always log the
  // diagnostic comparison so we can confirm signature shape before enforcing.
  let computedSig;
  try {
    computedSig = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  } catch (err) {
    console.error('[hcp-webhook-proxy] HMAC computation failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'verification failed' }) };
  }

  const sigsMatch = sigHeader != null && timingSafeStringEqual(sigHeader, computedSig);

  if (isTestPing && !sigHeader) {
    console.log('[hcp-webhook-proxy] test ping: no signature header (expected for test pings); forwarding');
  } else if (verificationEnabled) {
    // Strict mode: reject mismatches.
    if (!sigHeader) {
      console.warn('[hcp-webhook-proxy] STRICT: missing signature header; rejecting');
      return { statusCode: 401, body: JSON.stringify({ error: 'signature missing' }) };
    }
    if (!sigsMatch) {
      console.warn('[hcp-webhook-proxy] STRICT: signature mismatch; rejecting. received=' + sigHeader + ' computed=' + computedSig);
      return { statusCode: 401, body: JSON.stringify({ error: 'signature verification failed' }) };
    }
    console.log('[hcp-webhook-proxy] STRICT: signature verified');
  } else {
    // Diagnostic mode: log and forward regardless of match.
    console.log('[hcp-webhook-proxy] DIAGNOSTIC mode: received=' + (sigHeader || '(none)') + ' computed=' + computedSig + ' match=' + sigsMatch);
  }

  // Build the forwarded body. We inject _internal_auth as a top-level field
  // because Xano can't reliably read arbitrary HTTP headers in XanoScript
  // text-mode today (no precedent in workspace, no public docs). The Xano
  // endpoint reads $input._internal_auth and scrubs the field before logging
  // to event_log to prevent secret leakage in raw_payload metadata.
  let forwardBody;
  try {
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    parsed._internal_auth = internalAuth;
    forwardBody = JSON.stringify(parsed);
  } catch (_e) {
    // Body wasn't JSON. Pass an envelope so Xano still sees the auth field.
    forwardBody = JSON.stringify({ _internal_auth: internalAuth, _raw_body_passthrough: rawBody });
  }

  // Forward to Xano. Internal auth also sent as header for forward-compat
  // with future Xano versions that gain header-read support; today it's read
  // from the body field only.
  let xanoResp;
  try {
    xanoResp = await fetch(xanoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': internalAuth,
      },
      body: forwardBody,
    });
  } catch (err) {
    console.error('[hcp-webhook-proxy] forward to Xano failed:', err.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'upstream unavailable' }) };
  }

  // Read Xano's response and proxy the status + body back to HCP.
  let respBody = '';
  try {
    respBody = await xanoResp.text();
  } catch (_e) {
    respBody = '';
  }

  return {
    statusCode: xanoResp.status,
    headers: { 'Content-Type': 'application/json' },
    body: respBody,
  };
};

// Constant-time string comparison to mitigate timing attacks on signature
// verification. Both inputs must be strings of equal length for the
// timingSafeEqual call to operate; we pre-check and short-circuit otherwise.
function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (_e) {
    return false;
  }
}
