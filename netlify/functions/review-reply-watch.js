// review-reply-watch — the REPLY half of the review engine. Google Business
// Profile emails "X left a review for Tn Appliance Exchange" the moment a review
// posts. This scans for those, has Ant DRAFT a warm, on-brand reply, and TEXTS
// Teddy the review + the draft + a one-tap link to post it. Responding to reviews
// lifts map-pack + Local Services Ads rank (and it's the decent thing).
//
// SAFETY RULE (hard): a NEGATIVE review (<=3 stars) is NEVER auto-anything — it's
// flagged URGENT and the draft is "review before posting" so a real person handles
// it. Only 4-5 star drafts are presented as ready-to-post. (Full auto-posting waits
// on the Business Profile API — case 4-9470000004382.)
//
// Reuses the pollers' Gmail OAuth. Dedups per REVIEW (author+rating+text) so a
// duplicate notification email can't double-text. Scheduled in netlify.toml.
//   GET ?dryrun=1   parse + draft without texting (for tuning)
'use strict';
const { google } = require('googleapis');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG = 3;
const OWNER = '+16154855795';
const GBP_REVIEWS_URL = 'https://business.google.com/reviews';
// last ~10 days of GBP review-notification mail
const QUERY = 'from:businessprofile-noreply@google.com (review OR "new review" OR rated) newer_than:10d';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function reviewKey(r) { return (String(r.author || '').toLowerCase().trim() + '|' + (r.rating || '?') + '|' + String(r.text || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)); }

// pull a readable text body out of a Gmail message payload
function decodePart(data) { try { return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } }
function bodyText(payload) {
  if (!payload) return '';
  let out = '';
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body && p.body.data) out += '\n' + decodePart(p.body.data);
    else if (p.mimeType === 'text/html' && p.body && p.body.data && !out) out += '\n' + decodePart(p.body.data).replace(/<[^>]+>/g, ' ');
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return out.replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

const SYSTEM = `You read a Google Business Profile "new review" notification email for TN Appliance Exchange (a family appliance-repair company; owner James "Teddy" Pivacek). Extract every review in the email and draft an owner reply for each.

Return ONLY compact JSON: {"reviews":[{"author":"first name or display name","rating":<int 1-5>,"text":"the review text, empty if none","reply_draft":"the owner's reply","reply_url":"a Reply/Read-review link if present in the email, else empty"}]}

Reply voice: warm, specific, human — like a real owner who cares, NOT a corporate template. Thank them by name. If they mention an appliance, tech, or detail, reference it. Keep it 1-3 sentences. Never use the robotic "We're sorry for your experience." Sign offs are optional and casual ("- Teddy, TN Appliance").

For 4-5 star reviews: write a confident, grateful reply ready to post.
For 1-3 star reviews: write a calm, accountable, human reply that takes ownership and offers to make it right with a direct contact — but keep it draft-quality for a human to approve. Do not be defensive.
If the email is a digest with multiple reviews, return one object per review. If you cannot find a rating, use your best read from the text/stars; if truly unknown, use 5 only when the wording is clearly positive, else 3.`;

async function draftFromEmail(subject, body, key) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 900, system: SYSTEM,
      messages: [{ role: 'user', content: `Subject: ${subject}\n\nEmail body:\n${String(body).slice(0, 6000)}\n\nReturn ONLY the JSON.` }],
    }),
  });
  const d = await resp.json();
  let txt = String((d && d.content && d.content[0] && d.content[0].text) || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  try { return (JSON.parse(txt).reviews) || []; } catch (_) { return []; }
}

async function seenKeys() {
  try {
    const rows = await crud.searchPage(EVENT_LOG, { action: 'review_reply_seen' }, { id: 'desc' }, 1);
    let m = (rows[0] || {}).metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return new Set((m && m.keys) || []);
  } catch (_) { return new Set(); }
}
async function saveKeys(set) { try { await crud.logEvent('review_reply_seen', { keys: [...set].slice(-120), at_ms: Date.now() }); } catch (_) {} }

exports.handler = async function (event) {
  const q0 = event.queryStringParameters || {};
  const dry = q0.dryrun === '1';
  const baseline = q0.baseline === '1';  // seed dedup with current reviews, send nothing
  if (String(await getSecret('REVIEW_REPLY_WATCH') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET, refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!clientId || !clientSecret || !refreshToken) return json(200, { ok: false, error: 'no gmail creds' });
  if (!anthropic) return json(200, { ok: false, error: 'no anthropic key' });

  // 1) pull GBP review-notification emails
  let msgs = [];
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const list = await gmail.users.messages.list({ userId: 'me', q: QUERY, maxResults: 15 });
    for (const m of (list.data.messages || [])) {
      try {
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
        const hs = (full.data.payload && full.data.payload.headers) || [];
        const subject = (hs.find((h) => h.name === 'Subject') || {}).value || '';
        msgs.push({ id: m.id, subject, body: bodyText(full.data.payload) });
      } catch (_) {}
    }
  } catch (e) { return json(200, { ok: false, error: 'gmail read failed: ' + String(e.message || e) }); }
  if (!msgs.length) return json(200, { ok: true, note: 'no review mail' });

  // 2) extract + draft, dedup per review
  const seen = await seenKeys();
  const fresh = [];
  for (const m of msgs) {
    const reviews = await draftFromEmail(m.subject, m.body, anthropic);
    for (const r of reviews) {
      const k = reviewKey(r);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      fresh.push(r);
    }
  }
  if (!fresh.length) { return json(200, { ok: true, note: 'no new reviews', scanned: msgs.length }); }

  // Baseline: record the current backlog as seen, text nothing. Run once before
  // going live so only reviews posted AFTER baseline alert.
  if (baseline) { await saveKeys(seen); return json(200, { ok: true, mode: 'baseline', seeded: fresh.length, scanned: msgs.length }); }

  // 3) text Teddy each new review + draft (negative = URGENT, review-first)
  const out = [];
  for (const r of fresh) {
    const rating = Number(r.rating) || 0;
    const neg = rating > 0 && rating <= 3;
    const stars = rating ? ('★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating))) : '(?)';
    const link = (r.reply_url && /^https?:\/\//.test(r.reply_url)) ? r.reply_url : GBP_REVIEWS_URL;
    const head = neg
      ? `⚠️ URGENT — new ${rating}★ review needs YOUR touch (do not auto-post):`
      : `⭐ New ${rating}★ review — reply ready:`;
    const body = `${head}\n${stars} from ${r.author || 'a customer'}${r.text ? ('\n"' + String(r.text).slice(0, 240) + '"') : ''}\n\nDraft reply:\n"${String(r.reply_draft || '').slice(0, 500)}"\n\n${neg ? 'Review + edit, then post: ' : 'Post it: '}${link}`;
    out.push(dry ? { author: r.author, rating, neg, review: r.text, draft: r.reply_draft } : { author: r.author, rating, neg, preview: body.slice(0, 120) });
    if (!dry) {
      try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: body, force_send: true, context_tag: neg ? 'review_reply_urgent' : 'review_reply_draft' }), signal: AbortSignal.timeout(12000) }); } catch (_) {}
    }
  }
  if (!dry) await saveKeys(seen);
  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', scanned: msgs.length, new_reviews: out.length, reviews: out });
};
