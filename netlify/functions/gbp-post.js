// gbp-post — post a custom "What's new" update to the Google Business Profile on demand
// (text + optional photo + a CTA button). Owner-gated. Posts land in the map pack. Also
// supports ?delete=<postName> to pull one. GBP local posts take a PHOTO (Google dropped
// video from posts), so pass a still-frame image URL as mediaUrl.
//   POST { secret, summary, mediaUrl?, actionType?='CALL', actionUrl? }
//   GET  ?secret=&delete=<full post name>
'use strict';
const { getSecret } = require('./_lib/secrets');
const gbp = require('./_lib/gbp');
function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
    if (q.delete) { try { const r = await gbp.deleteLocalPost(q.delete); return json(200, { ok: true, deleted: q.delete, r }); } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); } }
    return json(400, { ok: false, error: 'POST {summary,mediaUrl?,actionType?,actionUrl?} — or GET ?delete=<postName>' });
  }

  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  if (b.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  if (!b.summary) return json(400, { ok: false, error: 'summary required' });

  try {
    let r = await gbp.createLocalPost({ summary: b.summary, mediaUrl: b.mediaUrl || null, actionType: b.actionType || 'CALL', actionUrl: b.actionUrl || null });
    // If Google rejects the photo (too small / unfetchable), retry text-only so the post still lands.
    if ((!r || r.error) && b.mediaUrl) {
      r = await gbp.createLocalPost({ summary: b.summary, actionType: b.actionType || 'CALL', actionUrl: b.actionUrl || null });
      return json(200, { ok: !r.error, media_dropped: true, note: 'photo rejected by Google — posted text-only', post: r });
    }
    return json(200, { ok: !(r && r.error), post: r });
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};
