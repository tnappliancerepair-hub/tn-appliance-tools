// page-photo-post — admin tool: post one or more image URLs to the Facebook Page
// as a single post (multi-photo => one swipeable post), with our own caption.
// Used to drop the review cards onto the Page so they're boost-ready / selectable
// in Ads Manager. Owner-gated on VAPI_ADMIN_SECRET.
//
//   POST { secret, image_urls:[...] | image_url, caption, published? }  -> { ok, post_id }
'use strict';
const { getSecret } = require('./_lib/secrets');

const GRAPH = 'https://graph.facebook.com/v21.0';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });

  const urls = Array.isArray(b.image_urls) && b.image_urls.length ? b.image_urls : (b.image_url ? [b.image_url] : []);
  if (!urls.length) return json(400, { error: 'pass image_urls[] or image_url' });
  const caption = String(b.caption || '').slice(0, 5000);
  const published = b.published === false ? false : true;

  const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
  if (!token || !pageId) return json(400, { error: 'facebook_not_connected' });

  // Single image -> one photo post with the caption.
  if (urls.length === 1) {
    const r = await fetch(`${GRAPH}/${pageId}/photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urls[0], caption, published, access_token: token }),
    });
    const d = await r.json();
    return r.ok ? json(200, { ok: true, mode: 'single', id: d.id, post_id: d.post_id || d.id, url: `https://www.facebook.com/${d.post_id || d.id}` })
      : json(502, { ok: false, error: (d.error && d.error.message) || d.error || 'failed' });
  }

  // Multi image -> upload each UNPUBLISHED to get media fbids, then one feed post.
  const media = [];
  for (const u of urls) {
    const r = await fetch(`${GRAPH}/${pageId}/photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: u, published: false, temporary: true, access_token: token }),
    });
    const d = await r.json();
    if (!r.ok || !d.id) return json(502, { ok: false, step: 'upload_photo', error: (d.error && d.error.message) || d.error || 'failed', uploaded: media.length });
    media.push({ media_fbid: d.id });
  }
  const attach = {};
  media.forEach((m, i) => { attach['attached_media[' + i + ']'] = JSON.stringify(m); });
  const fr = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ message: caption, published, access_token: token }, attach)),
  });
  const fd = await fr.json();
  return fr.ok ? json(200, { ok: true, mode: 'multi', photos: media.length, post_id: fd.id, url: `https://www.facebook.com/${fd.id}` })
    : json(502, { ok: false, step: 'create_feed_post', error: (fd.error && fd.error.message) || fd.error || 'failed', photos: media.length });
};
