// return-label-image — stream a SquareTrade return-label PNG through our own origin
// as image/png INLINE, so the phone DISPLAYS it (and can print it) instead of
// forcing a raw-file download (S3 serves it as application/octet-stream).
//   GET ?u=<url-encoded signed S3 label url>
'use strict';

exports.handler = async function (event) {
  const u = (event.queryStringParameters || {}).u || '';
  let dec = '';
  try { dec = decodeURIComponent(u); } catch (_) { dec = u; }
  // only proxy SquareTrade's shipping-label S3 objects — never an open proxy
  let host = '';
  try { host = new URL(dec).host; } catch (_) { return { statusCode: 400, body: 'bad url' }; }
  if (!/\.amazonaws\.com$/i.test(host) || !/\/shipping\//.test(dec)) {
    return { statusCode: 400, body: 'not a label url' };
  }
  try {
    const r = await fetch(dec, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { statusCode: 502, body: 'label fetch ' + r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline; filename="return-label.png"',
        'Cache-Control': 'private, max-age=600',
      },
      body: buf.toString('base64'),
    };
  } catch (e) {
    return { statusCode: 502, body: 'label proxy failed: ' + String((e && e.message) || e) };
  }
};
