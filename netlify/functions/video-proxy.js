// video-proxy — makes Studio clips PLAY INLINE. Vizard's CDN serves finished clips
// with Content-Disposition: attachment, which iOS Safari refuses to play in a <video>
// box. This re-serves a queue clip's bytes with inline headers + honest range support
// (capped per request so we stay under the function response limit). Job-scoped +
// owner-gated (only clips already in our queue can be proxied — no open SSRF).
//   GET ?secret=<VAPI_ADMIN_SECRET>&job=<id>   (Range honored)
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');

const QUEUE_KEY = 'VIDEO_STUDIO_QUEUE';
const CAP = 3 * 1024 * 1024; // 3MB/chunk → ~4MB base64, safely under the 6MB limit

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  let queue = []; try { queue = JSON.parse((await getSecretFresh(QUEUE_KEY)) || '[]'); } catch (_) {}
  const job = queue.find((j) => String(j.id) === String(q.job));
  const src = job && job.download_url;
  if (!src) return { statusCode: 404, body: 'not found' };

  // Parse the client's Range; cap open-ended requests so the response stays small.
  const range = event.headers.range || event.headers.Range || '';
  let start = 0, end = null;
  const m = range.match(/bytes=(\d+)-(\d*)/);
  if (m) { start = parseInt(m[1], 10) || 0; end = m[2] ? parseInt(m[2], 10) : null; }
  const reqEnd = end !== null ? Math.min(end, start + CAP - 1) : start + CAP - 1;

  let r;
  try { r = await fetch(src, { headers: { Range: `bytes=${start}-${reqEnd}` } }); }
  catch (e) { return { statusCode: 502, body: 'fetch failed' }; }
  if (!(r.status === 206 || r.status === 200)) return { statusCode: 502, body: 'upstream ' + r.status };

  const buf = Buffer.from(await r.arrayBuffer());
  // Total size from upstream Content-Range ("bytes s-e/total") or Content-Length.
  let total = null;
  const cr = r.headers.get('content-range');
  if (cr) { const t = cr.match(/\/(\d+)$/); if (t) total = parseInt(t[1], 10); }
  if (total == null) { const cl = r.headers.get('content-length'); if (cl) total = parseInt(cl, 10); }
  const realEnd = start + buf.length - 1;

  return {
    statusCode: 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${realEnd}/${total != null ? total : realEnd + 1}`,
      'Content-Length': String(buf.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
