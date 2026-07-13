// gbp-post-generator — the map-pack freshness engine. A fresh Google Business
// Profile post is a real local-ranking signal AND free visibility for "dryer repair
// near me" searchers. Ant drafts an on-brand post (dryer-weighted, the demand push)
// and AUTO-PUBLISHES it via the Business Profile API (approved 2026-07-10). If the
// API post fails, it falls back to TEXTING Teddy the draft + a one-tap link so a
// cadence slot never goes silent.
//
// Cadence = TWICE a week (Mon + Thu crons). ~2/week is the freshness sweet spot;
// past that the ranking benefit flattens and posts just bury each other. Dedups per
// (ISO week, half-week slot) so a retry can't double-post. Topics rotate + the 2nd
// weekly post is offset so the pair never repeats.
// Kill switch: vault GBP_POST_GENERATOR=false. Draft-only mode: vault GBP_AUTOPOST=false.
// ?dryrun=1 to preview.  ?test=1 (admin) publishes then immediately deletes (proof).
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const gbp = require('./_lib/gbp');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const GBP_POSTS_URL = 'https://business.google.com/posts';
const BOOK_URL = 'https://tnapplianceexchange.net/';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() * 100 + Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
}

// dryer-weighted rotation (the demand push), with the ALWAYS-ON message (our real
// moat — 24/7/365, contact us anytime on your own time, we text you right back)
// woven through so it recurs, plus safety + trust angles.
const TOPICS = [
  'A dryer-repair tip: why a dryer that "runs but won\'t dry" is usually airflow or a heating element — and that it\'s an affordable fix, not a replacement.',
  'An ALWAYS-ON post: we\'re here 24/7, 365 days a year. Text us, call us, or send a quick video anytime — day, night, weekend, holiday — and a real answer comes back. No phone tag, no waiting for business hours. Contact us on YOUR time.',
  'A dryer-not-heating post: the common causes (heating element, thermal fuse, thermostat) and that we come out same-day with the part on the truck.',
  'A do-it-on-your-own-time post: snap a 10-second video of the appliance acting up — at midnight, on your lunch break, whenever works for you — send it over and we tell you what\'s wrong. No sitting on hold, no waiting room.',
  'A trust post: we REPAIR appliances, we don\'t sell used ones — we answer live, 24/7, and give an upfront price before any work starts.',
  'A we-text-you-right-back post: call OR text anytime and Appliance Ant answers in seconds, then a real technician takes it from there. Repair on your schedule, not ours.',
  'A dryer-vent safety post: a clogged vent is a fire risk and makes drying take 2-3 cycles. (Mention we\'re CSIA C-DET certified and can clean inside the dryer too.)',
  'A "is it worth fixing?" post: most appliance problems are inexpensive parts — age matters less than people think. Honest cost-of-repair every time. And you can ask us anytime, day or night.',
  'A dryer-making-noise post: squealing or thumping usually means drum rollers, idler pulley, or belt — a quick, common fix.',
  'A local + always-on post: same-day appliance repair across Middle Tennessee and the Walker/Hammond/Baton Rouge area, reachable 24/7/365 — book online or text us anytime and we text you right back.',
  'A dryer-wont-start post: door switch, start switch, or thermal fuse are the usual culprits — we diagnose it fast and fix it right.',
];

const SYSTEM = `You write a single Google Business Profile "post/update" for TN Appliance Exchange — a family-owned, technician-led appliance repair company (owner James "Teddy" Pivacek) serving Middle Tennessee and the Walker/Hammond/Baton Rouge area of Louisiana.

Voice: warm, plainspoken, honest, local, confident — a real small-business owner who fixes appliances, NOT a marketing agency. No hype, no emojis spam (one tasteful emoji max), no ALL CAPS.

Rules:
- 90-160 words. One short paragraph or two. Easy to skim on a phone.
- Include a natural local reference (Nashville / Middle Tennessee / Baton Rouge area) — this is for local SEO, but it must read like a human, never keyword-stuffed. If the angle is about a specific appliance/symptom, name it; if the angle is our always-on availability, lead with that instead — don't force an appliance keyword in.
- When the angle is availability: hammer that we're reachable 24/7, 365 days a year — text, call, or send a quick video anytime, even the middle of the night, and we text you right back. That "on your own time, we always answer" promise is our biggest edge — make it the hero of those posts.
- End with a clear call to action to book, text, or call. The booking link and phone are added by the system — you just write the words leading into it (e.g. "Text us anytime and we'll text you right back, or book online.").
- We REPAIR, we don't sell used appliances — never imply we sell machines.
- Never invent specific prices, dates, or guarantees. Keep claims honest and general.

Return ONLY compact JSON: {"title":"a short post headline (max ~58 chars)","body":"the post text (no link, no phone — those get appended)"}`;

async function draftPost(topic, key) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: SYSTEM,
      messages: [{ role: 'user', content: `Write this week's post on this angle:\n${topic}\n\nReturn ONLY the JSON.` }],
    }),
  });
  const d = await resp.json();
  let txt = String((d && d.content && d.content[0] && d.content[0].text) || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(txt); } catch (_) { return null; }
}

// Has THIS bucket (iso_week + slot a/b) already gone out? Scans recent publish rows.
async function bucketPosted(bucketKey) {
  try {
    const rows = await crud.searchPage(3, { action: 'gbp_post_published' }, { id: 'desc' }, 8);
    for (const r of rows) {
      let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
      if (m && m.bucket === bucketKey) return true;
    }
    return false;
  } catch (_) { return false; }
}

async function textDraft(post, note) {
  const sms = `📣 Google Business post${note ? ' (' + note + ')' : ''} — ready to publish:\n\n${post.title ? '“' + post.title + '”\n' : ''}${post.body}\n\n(Booking link + phone get added.)\n\nPost it here → ${GBP_POSTS_URL}`;
  try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: sms, force_send: true, context_tag: 'gbp_post_draft' }), signal: AbortSignal.timeout(12000) }); } catch (_) {}
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  const test = q.test === '1';
  const publish = q.publish === '1';   // admin: publish ONE post now (keeps it), ignores dedup
  if (test || publish) {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  }
  if (String(await getSecret('GBP_POST_GENERATOR') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!anthropic) return json(200, { ok: false, error: 'no anthropic key' });
  const autopost = String(await getSecret('GBP_AUTOPOST') || '').toLowerCase() !== 'false';

  const now = new Date();
  const wk = isoWeek(now);
  const dow = now.getUTCDay() || 7;            // 1=Mon .. 7=Sun (UTC ~ CT-adjacent for bucketing)
  const slot = dow < 4 ? 'a' : 'b';            // Mon-Wed = a, Thu-Sun = b -> 2 posts/week
  const bucket = `${wk}:${slot}`;
  if (!dry && !test && !publish) {
    if (await bucketPosted(bucket)) return json(200, { ok: true, note: 'already posted this slot', bucket });
  }

  // Vary the pair: slot b is offset half the list so the two weekly posts never match.
  // ?theme=alwayson (or the manual publish default) forces the core 24/7 post (idx 1).
  const topicIdx = (publish || q.theme === 'alwayson') ? 1 : ((wk + (slot === 'b' ? 4 : 0)) % TOPICS.length);
  const topic = TOPICS[topicIdx];
  const post = await draftPost(topic, anthropic);
  if (!post || !post.body) return json(200, { ok: false, error: 'draft failed' });

  const fullPost = `${post.body}\n\nBook: ${BOOK_URL}  ·  Call/text 615-280-2949`;
  if (dry) return json(200, { ok: true, mode: 'dryrun', bucket, topic, title: post.title, post: fullPost });

  // TEST: publish then immediately delete — proves the API path without leaving a post.
  if (test) {
    const r = await gbp.createLocalPost({ summary: post.body, actionType: 'BOOK', actionUrl: BOOK_URL });
    const name = r.data && r.data.name;
    let deleted = null;
    if (r.ok && name) { const d = await gbp.deleteLocalPost(name); deleted = d.ok; }
    return json(200, { ok: r.ok, mode: 'test', published: r.ok, post_name: name || null, deleted, status: r.status, error: r.ok ? undefined : r.data });
  }

  // PUBLISH: fire one real post NOW and keep it (admin on-demand). Logged with a manual
  // bucket so it never blocks a scheduled Mon/Thu slot.
  if (publish) {
    const r = await gbp.createLocalPost({ summary: post.body, actionType: 'BOOK', actionUrl: BOOK_URL });
    if (r.ok) {
      try { await crud.logEvent('gbp_post_published', { bucket: 'manual:' + Date.now(), title: post.title || '', topic, post_name: (r.data && r.data.name) || '', manual: true, at_ms: Date.now() }); } catch (_) {}
    }
    return json(200, { ok: r.ok, mode: 'publish', published: r.ok, title: post.title, post: fullPost, post_name: (r.data && r.data.name) || null, status: r.status, error: r.ok ? undefined : r.data });
  }

  // LIVE: auto-publish via the API; fall back to texting Teddy the draft on any failure.
  if (autopost) {
    try {
      const r = await gbp.createLocalPost({ summary: post.body, actionType: 'BOOK', actionUrl: BOOK_URL });
      if (r.ok) {
        try { await crud.logEvent('gbp_post_published', { bucket, iso_week: wk, slot, title: post.title || '', topic, post_name: (r.data && r.data.name) || '', at_ms: Date.now() }); } catch (_) {}
        try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: `✅ Auto-posted your Google Business update:\n\n${post.title ? '“' + post.title + '”\n' : ''}${String(post.body).slice(0, 180)}…\n\nLive now on your profile. (2×/week: Mon + Thu.)`, force_send: true, context_tag: 'gbp_post_published' }), signal: AbortSignal.timeout(12000) }); } catch (_) {}
        return json(200, { ok: true, mode: 'autopost', bucket, title: post.title, post_name: (r.data && r.data.name) || null });
      }
      // API said no — hand it to Teddy so the slot isn't lost.
      await textDraft(post, 'auto-post failed, please tap');
      try { await crud.logEvent('gbp_post_autopost_failed', { bucket, status: r.status, err: JSON.stringify(r.data).slice(0, 200), at_ms: Date.now() }); } catch (_) {}
      return json(200, { ok: false, mode: 'fallback_text', bucket, status: r.status, error: r.data });
    } catch (e) {
      await textDraft(post, 'auto-post error, please tap');
      return json(200, { ok: false, mode: 'fallback_text', bucket, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  // Draft-only mode (GBP_AUTOPOST=false): text Teddy + log the slot so it dedups.
  await textDraft(post);
  try { await crud.logEvent('gbp_post_published', { bucket, iso_week: wk, slot, title: post.title || '', topic, draft_only: true, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: true, mode: 'draft_text', bucket, title: post.title, sent: true });
};
