// social-post-generator — one content engine for Facebook + Instagram + TikTok.
// Ant drafts an on-brand weekly content pack (FB post + IG caption/hashtags + a
// TikTok script/hook for whoever films it) and, in DRAFT mode, texts it to Teddy
// to post. Flips to AUTO-PUBLISH on FB + IG the moment the Meta Page token is
// vaulted (SOCIAL_FB_PAGE_TOKEN / SOCIAL_FB_PAGE_ID / SOCIAL_IG_USER_ID) — same
// draft-and-tap → auto pattern as gbp-post-generator.
//
// Rotates topics by ISO week; dedups once per ISO week. Kill switch:
// vault SOCIAL_POST_GENERATOR=false.  ?dryrun=1 to preview the full pack.
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const OWNER = '+16154855795';
const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
// square marketing images (IG-friendly 1:1) to rotate on auto-post
const IG_IMAGES = ['/assets/marketing/truck-wrap-square.jpg', '/assets/marketing/truck-sky.jpg', '/assets/marketing/crew-1.jpg', '/assets/marketing/crew-2.jpg'];

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function isoWeek(d) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() * 100 + Math.ceil((((t - ys) / 86400000) + 1) / 7); }

const TOPICS = [
  'The honest "repair or replace?" call — why age matters less than parts availability and what part failed. Point them to the $50 Quick Check.',
  'Behind the wrapped truck: "Stop guessing, ask a technician." Why we show customers the real 4-option Technician Decision Report instead of hiding part numbers.',
  'A dryer that runs but won\'t dry is almost always airflow or a heating element — an affordable fix, not a $1,000 replacement. Real tip, honest framing.',
  'Fridge not cooling? Before you panic-buy a new one, here\'s what a real technician checks first — and why a Quick Check saves you from a wrong purchase.',
  'Why we never share part numbers with customers (and why that actually protects you) — the transparency angle that sets us apart.',
  'Meet the crew — a family that fixes things. Local techs in Middle TN and Louisiana who tell you the truth about your appliance.',
  'Washer won\'t drain or spin? The usual suspects (pump, belt, lid switch) and why it\'s usually a same-week fix. Educational + local.',
  'Seasonal: summer heat + humidity is brutal on refrigerators and freezers — signs your fridge is struggling before it quits.',
];

const SYSTEM = `You write social posts for TN Appliance Exchange — an honest, transparent, AI-assisted appliance repair company in Middle Tennessee and Louisiana. Voice: plain, confident, human, a little warm — a real technician, not a marketer. No hype, no fake urgency, no emojis-as-punctuation spam (1-2 tasteful emojis max). Their edge: honesty (a $50 Quick Check credited toward the repair, a Technician Decision Report with 4 real options, they never share part numbers, they ship the part if you want to DIY). Never invent stats, reviews, or specific claims.

Return ONLY a JSON object:
{
 "fb_post": "a Facebook post, 2-4 short sentences, community tone, ends with a soft CTA to chat with Ant on the website or call",
 "ig_caption": "an Instagram caption for the same idea, slightly punchier, first line is a hook",
 "ig_hashtags": "8-12 relevant hashtags, space-separated, mixing local (city/state) and niche (appliance repair) — no banned/spammy tags",
 "tiktok_hook": "a 1-line scroll-stopping hook to say in the first 2 seconds",
 "tiktok_script": "a 20-30 second TikTok script (spoken lines + quick shot directions in brackets) someone can film with a phone — truck, a quick repair, or talking to camera",
 "tiktok_caption": "a short TikTok caption + 3-5 hashtags"
}`;

async function draftPack(topic, key) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1100, system: SYSTEM, messages: [{ role: 'user', content: `Write this week's content pack. Topic: ${topic}\nReturn ONLY the JSON.` }] }),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  let t = ((d && d.content && d.content[0] && d.content[0].text) || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(t); } catch (_) { return null; }
}

// Meta Graph publish (only runs when the token is vaulted)
async function publishFB(pageId, token, message) {
  try { const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, access_token: token }) }); const d = await r.json(); return { ok: r.ok, id: d.id, err: d.error }; } catch (e) { return { ok: false, err: String(e.message || e) }; }
}
async function publishIG(igId, token, imageUrl, caption) {
  try {
    const c = await fetch(`https://graph.facebook.com/v21.0/${igId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }) }).then((r) => r.json());
    if (!c.id) return { ok: false, err: c.error || 'no container' };
    const p = await fetch(`https://graph.facebook.com/v21.0/${igId}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: c.id, access_token: token }) }).then((r) => r.json());
    return { ok: !!p.id, id: p.id, err: p.error };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  if (String(await getSecret('SOCIAL_POST_GENERATOR') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(200, { ok: false, error: 'no anthropic key' });

  const wk = isoWeek(new Date());
  if (!dry) { const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'social_pack_generated' }, { created_at: 'desc' }, 20).catch(() => []); if ((prior || []).some((r) => { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m && m.iso_week === wk; })) return json(200, { ok: true, skipped: 'already generated this week', iso_week: wk }); }

  const topic = TOPICS[wk % TOPICS.length];
  const pack = await draftPack(topic, key);
  if (!pack || !pack.fb_post) return json(200, { ok: false, error: 'draft failed' });

  // auto-publish when the Meta token is present; else draft-and-tap
  const [fbToken, fbPage, igId] = await Promise.all([getSecret('SOCIAL_FB_PAGE_TOKEN'), getSecret('SOCIAL_FB_PAGE_ID'), getSecret('SOCIAL_IG_USER_ID')]);
  const fbMsg = `${pack.fb_post}\n\n🐜 Chat with Ant or book: ${SITE}  ·  📞 615-280-2949`;
  const igCap = `${pack.ig_caption}\n\n${pack.ig_hashtags || ''}`;
  let published = null;
  if (!dry && fbToken && fbPage) {
    published = { facebook: await publishFB(fbPage, fbToken, fbMsg) };
    if (igId) published.instagram = await publishIG(igId, fbToken, SITE + IG_IMAGES[wk % IG_IMAGES.length], igCap);
  }

  if (!dry) {
    try { await crud.logEvent('social_pack_generated', { iso_week: wk, topic, auto: !!(fbToken && fbPage), at_ms: Date.now() }); } catch (_) {}
    if (!published) {
      const sms = `📣 This week's social pack — ready to post:\n\n— FACEBOOK —\n${fbMsg}\n\n— INSTAGRAM —\n${igCap}\n\n— TIKTOK (for Alec) —\nHook: ${pack.tiktok_hook}\n${pack.tiktok_script}\n${pack.tiktok_caption || ''}`;
      try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: sms.slice(0, 1400), recipient_role: 'owner', context: 'social_pack' }) }); } catch (_) {}
    }
  }

  return json(200, { ok: true, iso_week: wk, topic, mode: published ? 'auto-published' : (dry ? 'dryrun' : 'draft-texted'), pack, fb_message: fbMsg, ig_caption: igCap, published });
};
