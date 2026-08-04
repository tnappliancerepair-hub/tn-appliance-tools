// gbp-review-responder — the "profile everyone envies" engine.
//
// Responding to EVERY review, fast, is one of the strongest map-pack signals
// Google rewards — and the most visible trust signal a shopper sees. This pulls
// reviews straight from the GBP API (not Gmail), drafts a warm on-brand owner
// reply, and:
//   • 4-5★  → AUTO-POSTS the reply via the API (instant, grateful, specific).
//   • 1-3★  → drafts + texts the owner (human touch — never auto-posted).
// Idempotent by design: skips any review that already has an owner reply, so
// re-runs and the cron never double-post.
//
//   GET ?dryrun=1&secret=<admin>   preview drafts, post nothing (for tuning)
//   GET ?live=1&secret=<admin>     post 4-5★ replies now, text owner on 1-3★
//   (scheduled cron self-authorizes and runs live)
//
// Kill switch: vault GBP_REVIEW_RESPONDER=false.  Per-run cap: GBP_REVIEW_MAX (default 12).
'use strict';
const gbp = require('./_lib/gbp');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const OWNER = '+16154855795';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG = 3;
const STAR = { FIVE: 5, FOUR: 4, THREE: 3, TWO: 2, ONE: 1, STAR_RATING_UNSPECIFIED: 0 };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const SYSTEM = `You write the owner's public reply to a Google review for TN Appliance Exchange — a family-owned, technician-led appliance repair company in Middle Tennessee and Louisiana, in business since 2012, owned by James "Teddy" Pivacek. Voice: warm, genuine, specific, humble, never corporate or robotic. Sound like a real family business that actually cares.

Rules:
- 1-3 sentences. No hashtags. No exclamation-point spam (one at most).
- Thank them by first name if you can tell it.
- If the review mentions a specific tech (Teddy, Jimmy, Andre, Lee, John), an appliance, or a detail, reference it naturally — that proves a human read it.
- Never mention part numbers or specific prices.
- For 4-5 star reviews: warm and grateful, invite them back, mention we're a text/call away.
- For 1-3 star reviews: calm, accountable, take ownership, no excuses, no defensiveness; offer to make it right and give the number 615-280-2949.
- Never invent facts about the visit. If the review has no text, write a short sincere thank-you for the rating.
Return ONLY the reply text — no quotes, no preamble.`;

async function draft(key, review) {
  const stars = STAR[review.starRating] || 0;
  const who = (review.reviewer && review.reviewer.displayName) || 'a customer';
  const txt = String(review.comment || '').slice(0, 1500);
  const user = `Rating: ${stars} star(s)\nReviewer: ${who}\nReview text: ${txt || '(no text — rating only)'}\n\nWrite the owner reply.`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 320, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await resp.json();
  return String((d && d.content && d.content[0] && d.content[0].text) || '').trim().replace(/^["']|["']$/g, '').slice(0, 900);
}

async function textOwner(body, tag) {
  try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: body, force_send: true, context_tag: tag }), signal: AbortSignal.timeout(12000) }); } catch (_) {}
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  if (String((await getSecret('GBP_REVIEW_RESPONDER')) || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  if (!(await gbp.isConfigured())) return json(200, { ok: false, error: 'gbp not configured' });

  const dry = q.dryrun === '1' && !scheduled;
  const live = scheduled || q.live === '1';
  const MAX = Math.max(1, Math.min(25, parseInt(await getSecret('GBP_REVIEW_MAX'), 10) || 12));
  const key = await getSecret('ANTHROPIC_API_KEY');

  let acctLoc;
  try { acctLoc = await gbp.resolveAccountLocation(); } catch (e) { return json(200, { ok: false, error: 'resolve failed: ' + String(e && e.message || e) }); }

  // pull recent reviews (API orders by updateTime desc)
  let reviews = [];
  try { const r = await gbp.listReviews(acctLoc.accountId, acctLoc.locationId); reviews = (r.data && r.data.reviews) || []; }
  catch (e) { return json(200, { ok: false, error: 'listReviews failed: ' + String(e && e.message || e) }); }

  const unreplied = reviews.filter((rv) => !rv.reviewReply);
  const posted = [], flagged = [], errors = [];
  let done = 0;

  for (const rv of unreplied) {
    if (done >= MAX) break;
    const stars = STAR[rv.starRating] || 0;
    const who = (rv.reviewer && rv.reviewer.displayName) || 'a customer';
    let reply = '';
    try { reply = await draft(key, rv); } catch (_) {}
    if (!reply) { errors.push({ who, stars, why: 'draft failed' }); continue; }

    if (stars >= 4) {
      // auto-post the positive reply
      if (dry) { posted.push({ who, stars, reply, mode: 'DRYRUN' }); done++; continue; }
      try {
        const pr = await gbp.putReply(rv.name, reply);
        if (pr && pr.ok !== false && pr.status !== 401 && pr.status !== 403) {
          posted.push({ who, stars, reply });
          try { await crud.logEvent('gbp_review_replied', { who, stars, auto: true, review: String(rv.comment || '').slice(0, 120), at_ms: Date.now() }); } catch (_) {}
        } else { errors.push({ who, stars, why: 'putReply ' + (pr && pr.status) }); }
      } catch (e) { errors.push({ who, stars, why: String(e && e.message || e) }); }
      done++;
    } else {
      // negative → draft to owner, never auto-post
      flagged.push({ who, stars, review: String(rv.comment || '').slice(0, 160), draft: reply });
      if (!dry) {
        const stxt = '★'.repeat(stars) + '☆'.repeat(Math.max(0, 5 - stars));
        await textOwner(`⚠️ URGENT — new ${stars}★ review needs YOUR touch (not auto-posted):\n${stxt} from ${who}\n"${String(rv.comment || '').slice(0, 220)}"\n\nDraft reply:\n"${reply}"\n\nReview + post: https://business.google.com/reviews`, 'review_reply_urgent');
        try { await crud.logEvent('gbp_review_flagged', { who, stars, at_ms: Date.now() }); } catch (_) {}
      }
      done++;
    }
  }

  return json(200, {
    ok: true, mode: dry ? 'dryrun' : (live ? 'live' : 'preview'),
    total_reviews_seen: reviews.length, unreplied: unreplied.length, processed: done, cap: MAX,
    auto_posted: posted.length, flagged_to_owner: flagged.length, errors: errors.length,
    posted, flagged, errors: errors.slice(0, 5),
  });
};
