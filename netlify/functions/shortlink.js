// Short branded link for the cash-TDR customer view — cuts the ~147-char token
// URL down to ~20 chars so the SMS drops from ~2 segments to 1 (Teddy 2026-08-11
// SMS-cost work). Storage-free + secure by design:
//
//   /t/<jobId>-<tdrId>-<sig>
//
// The <sig> is a 10-hex-char HMAC of "sl:<jobId>-<tdrId>" keyed by QC_TOKEN_SECRET,
// so the code is unguessable (you can't forge another job's link) yet needs no
// database. On each click we MINT A FRESH durable qc token (same shape as
// generate-qc-token) and 302 to cash-tdr-customer.html — so the short link never
// expires and always resolves to a live token. Companion minter: generate-qc-token
// returns the matching short_url. Redirect rule: _redirects `/t/*`.

const crypto = require('crypto');

const SITE = 'https://tnapplianceexchange.net';
const DURABLE_SECONDS = 315360000; // ~10 years — matches generate-qc-token's durable floor

function sigFor(jobId, tdrId, secret) {
  return crypto.createHmac('sha256', secret).update(`sl:${jobId}-${tdrId}`, 'utf8').digest('hex').slice(0, 10);
}

function mintToken(jobId, tdrId, secret) {
  const expiryUnix = Math.floor(Date.now() / 1000) + DURABLE_SECONDS;
  const payload = { job_id: jobId, tdr_id: tdrId, expiry_unix: expiryUnix, v: 1 };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64, 'utf8').digest('hex');
  return payloadB64 + '.' + signature;
}

exports.handler = async function (event) {
  const tokenSecret = process.env.QC_TOKEN_SECRET;
  const q = event.queryStringParameters || {};
  // code comes from the _redirects splat (?code=:splat) or a raw path fallback
  let code = String(q.code || '').trim();
  if (!code && event.path) code = String(event.path).replace(/^\/t\//, '').trim();

  const bad = () => ({ statusCode: 302, headers: { Location: `${SITE}/` }, body: '' });

  if (!tokenSecret || !code) return bad();

  // Parse <jobId>-<tdrId>-<sig>
  const m = code.match(/^(\d+)-(\d+)-([0-9a-f]{10})$/i);
  if (!m) return bad();
  const jobId = parseInt(m[1], 10);
  const tdrId = parseInt(m[2], 10);
  const sig = m[3].toLowerCase();

  // Verify the signature (timing-safe) so the code can't be forged/enumerated.
  const expected = sigFor(jobId, tdrId, tokenSecret);
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8')); } catch (_) { ok = false; }
  if (!ok) return bad();

  const token = mintToken(jobId, tdrId, tokenSecret);
  return {
    statusCode: 302,
    headers: {
      Location: `${SITE}/cash-tdr-customer.html?token=${encodeURIComponent(token)}`,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
};
