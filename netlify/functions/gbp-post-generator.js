// gbp-post-generator — the map-pack freshness engine. A fresh Google Business
// Profile post every week is a real local-ranking signal AND free visibility for
// "dryer repair near me" searchers. Ant drafts an on-brand post (dryer-weighted,
// since that's the demand push) and TEXTS Teddy the draft + a one-tap link to post
// it. Flips to AUTO-POST when the Business Profile API approval lands
// (case 4-9470000004382) — until then it's draft-and-tap, like review-reply-watch.
//
// Rotates topics by ISO week so posts stay varied. Dedups to once per ISO week.
// Kill switch: vault GBP_POST_GENERATOR=false.  ?dryrun=1 to preview.
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const GBP_POSTS_URL = 'https://business.google.com/posts';
const BOOK_URL = 'https://tnapplianceexchange.net/book-repair.html?appliance=Dryer';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() * 100 + Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
}

// dryer-weighted rotation (the demand push), with safety + seasonal + trust mixed in
const TOPICS = [
  'A dryer-repair tip: why a dryer that "runs but won\'t dry" is usually airflow or a heating element — and that it\'s an affordable fix, not a replacement.',
  'A dryer-not-heating post: the common causes (heating element, thermal fuse, thermostat) and that we come out same-day with the part on the truck.',
  'A trust post: we REPAIR dryers, we don\'t sell them — we answer the phone live and give an upfront price before any work starts.',
  'A dryer-vent safety post: a clogged vent is a fire risk and makes drying take 2-3 cycles. (Mention we\'re CSIA C-DET certified and can clean inside the dryer too.)',
  'A "is it worth fixing?" post: most dryer problems are inexpensive parts (belt, roller, fuse) — age matters less than people think. Honest cost-of-repair every time.',
  'A dryer-making-noise post: squealing or thumping usually means drum rollers, idler pulley, or belt — a quick, common fix.',
  'A local service post: same-day dryer repair across Middle Tennessee and the Walker/Hammond/Baton Rouge area — book online and we text you right back.',
  'A dryer-wont-start post: door switch, start switch, or thermal fuse are the usual culprits — we diagnose it fast and fix it right.',
];

const SYSTEM = `You write a single Google Business Profile "post/update" for TN Appliance Exchange — a family-owned, technician-led appliance repair company (owner James "Teddy" Pivacek) serving Middle Tennessee and the Walker/Hammond/Baton Rouge area of Louisiana.

Voice: warm, plainspoken, honest, local, confident — a real small-business owner who fixes appliances, NOT a marketing agency. No hype, no emojis spam (one tasteful emoji max), no ALL CAPS.

Rules:
- 90-160 words. One short paragraph or two. Easy to skim on a phone.
- Naturally include the phrase "dryer repair" (or the specific symptom) and a local reference — this is for local SEO, but it must read like a human, never keyword-stuffed.
- End with a clear call to action to book or call. The booking link and phone are added by the system — you just write the words leading into it (e.g. "Book online and we'll text you right back, or call us.").
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

async function lastWeekPosted() {
  try {
    const rows = await crud.searchPage(3, { action: 'gbp_post_generated' }, { id: 'desc' }, 1);
    let m = (rows[0] || {}).metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return (m && m.iso_week) || 0;
  } catch (_) { return 0; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  if (String(await getSecret('GBP_POST_GENERATOR') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!anthropic) return json(200, { ok: false, error: 'no anthropic key' });

  const now = new Date();
  const wk = isoWeek(now);
  if (!dry) {
    const last = await lastWeekPosted();
    if (last === wk) return json(200, { ok: true, note: 'already posted this week', iso_week: wk });
  }

  const topic = TOPICS[wk % TOPICS.length];
  const post = await draftPost(topic, anthropic);
  if (!post || !post.body) return json(200, { ok: false, error: 'draft failed' });

  const fullPost = `${post.body}\n\nBook: ${BOOK_URL}  ·  Call/text 615-280-2949`;
  const sms = `📣 This week's Google Business post — ready to publish:\n\n${post.title ? '“' + post.title + '”\n' : ''}${post.body}\n\n(Booking link + phone get added.)\n\nPost it here → ${GBP_POSTS_URL}`;

  if (dry) return json(200, { ok: true, mode: 'dryrun', iso_week: wk, topic, title: post.title, post: fullPost });

  try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: sms, force_send: true, context_tag: 'gbp_post_draft' }), signal: AbortSignal.timeout(12000) }); } catch (_) {}
  try { await crud.logEvent('gbp_post_generated', { iso_week: wk, title: post.title || '', topic, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: true, mode: 'live', iso_week: wk, title: post.title, sent: true });
};
