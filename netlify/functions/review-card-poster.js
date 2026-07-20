// review-card-poster — auto-posts one branded review card as a NATIVE Facebook
// photo (+ Instagram photo), LA-flavored. Draws from the pool review-card-store
// built. Louisiana cards go FIRST (Teddy's "especially Louisiana"), and every
// caption names an LA service area + LA hashtags so the North Shore / South Shore /
// Baton Rouge see their neighbors' 5-stars. Genuine 5-star reviews only.
//
//   scheduled (cron)                 -> post one, only when SOCIAL_REVIEW_CARDS_LIVE=true
//   GET ?secret=<VAPI_ADMIN_SECRET>  -> post one now (manual, always allowed)
//   GET ?secret=...&dry=1            -> preview the next card + caption, no post
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { igPublish } = require('./_lib/social-fb');

const POOL_KEY = 'SOCIAL_REVIEW_CARD_POOL_POSTS';
function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o, null, 2) }; }

// Louisiana localization by TECH TERRITORY (Teddy 2026-07-20): a review naming a tech
// gets THAT tech's towns + local number, so it reads as hyper-local — "these are real
// customers in Kenner / Baton Rouge," not "a Tennessee company."
//   Andre  -> 504 (New Orleans) : Kenner, Metairie, New Orleans     [VERIFIED ringing to Ant]
//   John   -> 225 (Baton Rouge) : Baton Rouge, Hammond, Slidell     [225 not in Vapi yet -> 504 interim]
//   Billy  -> North Shore/Hammond (John's bucket)
const LA_504 = '504-355-9111';   // New Orleans — VERIFIED
const LA_225 = '';               // Baton Rouge — set when a real 225 is verified ringing to Ant
const TN_PHONE = '615-280-2949';
function laPhone(tech) { if (tech === 'john' || tech === 'billy') return LA_225 || LA_504; return LA_504; }
// Each LA card names a DIFFERENT set of real Louisiana towns (stored per card at
// render time) so the feed feels like we're EVERYWHERE — Hammond, Slidell, Gretna,
// Madisonville, Covington, Walker, Denham Springs, LaPlace, Manchac... every card
// still ties to "all Louisiana." The local NUMBER flexes by tech (Andre 504 / John
// 225). (Teddy 2026-07-20)
const LA_SWEEP_FALLBACK = 'New Orleans, Metairie, Baton Rouge & the North Shore';
const LA_TAGS = '#neworleans #metairie #kenner #gretna #batonrouge #denhamsprings #walker #hammondla #covington #madisonville #slidell #mandeville #laplace #northshorela #louisiana #nola';
const TN_TAGS = '#nashville #murfreesboro #antioch #tnappliance';

async function loadPool() { try { return JSON.parse((await getSecretFresh(POOL_KEY)) || '[]'); } catch (_) { return []; } }
async function savePool(p) { await setSecret(POOL_KEY, JSON.stringify(p)); }

function caption(card) {
  const first = String(card.author || '').split(' ')[0] || 'friend';
  if (card.is_la) {
    const phone = card.phone || laPhone(card.tech);
    const towns = card.towns || LA_SWEEP_FALLBACK;
    return `⭐️⭐️⭐️⭐️⭐️ Real 5-star service just about everywhere in Louisiana. 🐜\n\n`
      + `Thank you, ${first} — this is exactly why we do it. ${towns} — and just about everywhere in between. Wherever you're at, we've probably got you. 24/7: text a quick video, get a real answer, no runaround.\n\n`
      + `The people of Louisiana always show us love — and we're grateful. 🙏\n\n`
      + `📞 ${phone}  ·  tnapplianceexchange.net\n\n`
      + `#appliancerepair #familyowned #5starservice ${LA_TAGS}`;
  }
  const phone = card.phone || TN_PHONE;
  return `⭐️⭐️⭐️⭐️⭐️ Another 5-star from the family. 🐜\n\n`
    + `Thank you, ${first} — this is exactly why we do it. Broken appliance in Middle TN? We're here 24/7: text a quick video, get a real answer, no runaround. Real techs, honest fixes.\n\n`
    + `📞 ${phone}  ·  tnapplianceexchange.net\n\n`
    + `#appliancerepair #familyowned #5starservice ${TN_TAGS}`;
}

async function signedUrl(key) {
  const s3 = new S3Client({ region: process.env.TN_AWS_S3_REGION, credentials: { accessKeyId: process.env.TN_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.TN_AWS_SECRET_ACCESS_KEY } });
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.TN_AWS_S3_BUCKET, Key: key, ResponseContentType: 'image/png', ResponseContentDisposition: 'inline' }), { expiresIn: 900 });
}

async function fbPhoto(pageId, token, imageUrl, message) {
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: imageUrl, message, access_token: token }) });
    const d = await r.json();
    return { ok: r.ok && !!(d.id || d.post_id), id: d.post_id || d.id, err: d.error };
  } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dry === '1';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  // Scheduled runs self-authorize but only fire when the LIVE flag is on; manual (secret) always allowed.
  if (!scheduled && q.secret !== admin) return json(401, { error: 'unauthorized' });
  if (scheduled) {
    const live = String((await getSecret('SOCIAL_REVIEW_CARDS_LIVE')) || '').toLowerCase() === 'true';
    if (!live) return json(200, { ok: true, skipped: 'SOCIAL_REVIEW_CARDS_LIVE not true — cron idle' });
  }

  const pool = await loadPool();
  const remaining = pool.filter((x) => !x.posted);
  if (!remaining.length) return json(200, { ok: true, done: true, note: 'pool empty — top it up in review-cards.html', pool_size: pool.length });
  // Louisiana first, then the (interleaved Andre/John) render order — so daily posts
  // alternate territories and both techs get blown up all over the state.
  remaining.sort((a, b) => (b.is_la - a.is_la) || (a.added_ms - b.added_ms));
  const card = remaining[0];
  const idx = pool.indexOf(card);
  const cap = caption(card);

  if (dry) return json(200, { ok: true, dry_run: true, next: { author: card.author, is_la: card.is_la, key: card.key }, remaining: remaining.length, caption: cap });

  const token = await getSecret('SOCIAL_FB_PAGE_TOKEN');
  const pageId = await getSecret('SOCIAL_FB_PAGE_ID');
  if (!token || !pageId) return json(400, { error: 'facebook_not_connected' });

  let url;
  try { url = await signedUrl(card.key); } catch (e) { return json(502, { error: 'sign_failed', detail: String((e && e.message) || e) }); }

  const fb = await fbPhoto(pageId, token, url, cap);
  if (!fb.ok) return json(502, { ok: false, error: 'fb_photo_failed', detail: fb.err });

  // Instagram cross-post (photo). Best-effort — same signed image URL + caption.
  let ig = { posted: false };
  try {
    const igId = await getSecret('SOCIAL_IG_USER_ID');
    if (igId) { const r = await igPublish(igId, token, { caption: cap, imageUrl: url }); ig = { posted: !!r.ok, id: r.id, reason: r.ok ? undefined : (r.error || r.step) }; }
    else ig.reason = 'ig_not_connected';
  } catch (e) { ig.reason = String((e && e.message) || e); }

  pool[idx] = { ...card, posted: true, posted_ms: Date.now(), fb_post_id: fb.id, ig_id: ig.id || null };
  await savePool(pool);
  return json(200, { ok: true, posted: { author: card.author, is_la: card.is_la }, fb_post_id: fb.id, fb_url: `https://www.facebook.com/${fb.id}`, instagram: ig, remaining: remaining.length - 1 });
};
