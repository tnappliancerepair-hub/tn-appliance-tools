// media-proxy — builds a short-lived, HEAD-able pull URL for a raw Studio clip in S3
// so a third-party ingester (Submagic) can fetch it. An S3 SigV4 *presigned GET* URL
// is signed for the GET method, so a HEAD probe against it returns 403 — and Submagic
// validates a source URL with HEAD first, then rejects it as "not a downloadable media
// file." The proxy (submagic-media.js) answers HEAD itself and 302s the GET to S3.
//
// The URL carries a short HMAC token (bound to key+expiry) so it isn't an open proxy
// to the whole bucket. Secret = VAPI_ADMIN_SECRET (same value the proxy re-derives).
'use strict';
const crypto = require('crypto');

function signToken(key, expMs, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(key) + '|' + String(expMs)).digest('hex').slice(0, 32);
}

// TTL default 6h (matches the old direct-presign window). The URL ends in `/clip.mp4`
// so ingesters that infer the format from the URL extension (Vizard needs a non-empty
// `ext`; it errors 4006 on an extension-less URL) see ".mp4". Netlify routes the
// subpath to the function and the k/e/t query params are preserved. The HMAC signs
// key+expiry (not the path), so the token still validates.
//
// opts.redirect=true adds &m=r: the proxy 302-redirects to a fresh S3 presigned URL
// instead of streaming. Use this for ingesters that need a real Content-Length up
// front (Vizard errors 4005 "0 Bytes" off a chunked/streamed response — S3 supplies
// Content-Length on its own GET). Submagic can't take a 302, so it uses stream mode.
function buildProxyUrl(key, secret, ttlMs, opts) {
  opts = opts || {};
  const exp = Date.now() + (ttlMs || 6 * 3600 * 1000);
  const tok = signToken(key, exp, secret);
  return 'https://tnapplianceexchange.net/.netlify/functions/submagic-media/clip.mp4'
    + '?k=' + encodeURIComponent(key) + '&e=' + exp + '&t=' + tok
    + (opts.redirect ? '&m=r' : '');
}

module.exports = { signToken, buildProxyUrl };
