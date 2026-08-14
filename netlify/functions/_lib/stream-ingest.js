// stream-ingest — push a video into Cloudflare Stream so it plays on ANY device.
//
// Why: customers text videos via MMS. Older Android phones send `.3gp`
// (video/3gpp), which iPhone Safari CANNOT play inline — the tech just sees a
// black box (David Derocher job 21261, Teddy 2026-08-14). Cloudflare Stream
// accepts 3GP (and mp4/mov/webm/…) as INPUT and transcodes to HLS + a poster
// thumbnail that plays everywhere. The tech-job / office renderers already have a
// `cfstream:<uid>` code path (poster + iframe player), so once an attachment's
// s3_key is a cfstream key it renders + plays on iOS.
//
// Two entry points:
//   copyFromUrl(url)          — tell Stream to fetch+transcode from a URL (used to
//                               upgrade an EXISTING S3 object via its signed URL)
//   uploadBuffer(buf,name,mt) — direct multipart upload of fresh bytes (≤200MB;
//                               used at inbound MMS capture, no presign needed)
// Both return the Stream uid or null. Never throw — a failure just means we keep
// the raw file (current behavior), so capture is never broken by this.
'use strict';
const { getSecret } = require('./secrets');

async function creds() {
  const acct = await getSecret('CLOUDFLARE_ACCOUNT_ID');
  const token = await getSecret('CLOUDFLARE_STREAM_TOKEN');
  return (acct && token) ? { acct, token } : null;
}

function errText(d, status) {
  const errs = (d && d.errors) || [];
  const msg = errs.map((e) => (e && (e.message || e.code)) || '').filter(Boolean).join('; ');
  return msg || ('http_' + status);
}

// Returns { uid, status, error }. uid is null on failure (callers check res.uid).
async function copyFromUrl(url, meta) {
  const c = await creds(); if (!c) return { uid: null, error: 'no_stream_creds' };
  if (!url) return { uid: null, error: 'no_url' };
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.acct}/stream/copy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, meta: meta || {} }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    const uid = d && d.result && d.result.uid;
    return { uid: (r.ok && uid) ? uid : null, status: r.status, error: (r.ok && uid) ? null : errText(d, r.status) };
  } catch (e) { return { uid: null, error: String((e && e.message) || e) }; }
}

async function uploadBuffer(buf, filename, mime) {
  const c = await creds(); if (!c) return { uid: null, error: 'no_stream_creds' };
  if (!buf || !buf.length) return { uid: null, error: 'empty_buffer' };
  try {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime || 'video/mp4' }), filename || 'video.mp4');
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.acct}/stream`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}` },
      body: fd,
      signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => ({}));
    const uid = d && d.result && d.result.uid;
    return { uid: (r.ok && uid) ? uid : null, status: r.status, error: (r.ok && uid) ? null : errText(d, r.status) };
  } catch (e) { return { uid: null, error: String((e && e.message) || e) }; }
}

module.exports = { copyFromUrl, uploadBuffer };
