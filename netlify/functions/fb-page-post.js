// fb-page-post — one-off admin tool to publish a photo post to the TN Appliance
// Facebook Page (the giant-Ant AssistAnt announcement). Reuses _lib/social-fb.js's
// graphPost + the vaulted SOCIAL_FB_PAGE_TOKEN / SOCIAL_FB_PAGE_ID. Photo post so the
// ant card shows big; the link in the caption is clickable.
//
//   GET/POST ?secret=<VAPI_ADMIN_SECRET>&dryrun=1  -> shows what WOULD post, no publish
//   GET/POST ?secret=<VAPI_ADMIN_SECRET>&post=1     -> publishes to the Page
'use strict';

const { getSecret } = require('./_lib/secrets');
const socialFb = require('./_lib/social-fb');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const IMAGE = 'https://tnapplianceexchange.net/assistant-og.png';
const CAPTION = [
  'A little behind the scenes 🐜',
  '',
  'Ever notice we answer the phone day or night, text you right back, and keep you posted on your repair? That’s AssistAnt — the AI system we built to run our shop and take better care of you.',
  '',
  'Other shop owners kept asking how we do it… so now we’re sharing it. If you run a business that lives on answering the phone and taking care of customers — appliance repair, auto, you name it — AssistAnt can do the same for you, for less than $100/month.',
  '',
  'See it 👉 https://assistant247.net',
  '',
  'Long live the moneymakers. 🐜',
].join('\n');

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const secret = q.secret || b.secret;
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
  const pageToken = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  if (!pageId || !pageToken) {
    return json(200, { ok: false, error: 'fb page not configured', has_page_id: !!pageId, has_page_token: !!pageToken });
  }

  const doPost = (String(q.post || b.post) === '1') || (event.httpMethod === 'POST' && String(q.dryrun || b.dryrun) !== '1');
  if (!doPost) {
    return json(200, { ok: true, dry: true, page_id: pageId, image: IMAGE, caption: CAPTION });
  }

  // Photo post to the Page: the ant card shows big, link in the caption is clickable.
  const r = await socialFb.graphPost(`/${pageId}/photos`, { url: IMAGE, caption: CAPTION, access_token: pageToken });
  if (!r.ok) return json(200, { ok: false, error: 'fb_post_failed', status: r.status, data: r.data });

  const postId = (r.data && (r.data.post_id || r.data.id)) || '';
  const url = postId ? `https://www.facebook.com/${postId}` : '';
  return json(200, { ok: true, posted: true, post_id: postId, url, data: r.data });
};
