// gbp-review-autoreply — keep Google reviews caught up going forward.
// Scheduled: pulls the newest reviews, and for any WITHOUT a reply:
//   • 4-5 star  -> AUTO-POSTS a warm personalized reply (via the GBP API).
//   • 1-3 star  -> NEVER auto-posts. Texts Teddy the review + a ready draft so a
//                  real person handles it (the hard safety rule from day one).
// New reviews land at the top (orderBy updateTime desc), so page 1 is enough
// between runs. Positives dedup naturally (once replied, has_reply=true);
// negatives dedup via an event_log marker so Teddy isn't re-texted.
//
//   (scheduled)                      -> forward run (page 1: post 4-5★, text Teddy new 1-3★)
//   GET ?secret=<admin>[&dryrun=1]   -> manual forward run / preview (no posts, no texts)
//   GET ?secret=<admin>&audit=1[&pages=N]        -> walk the backlog, count replied vs
//                                                   unreplied by star (no posts). Measures the gap.
//   GET ?secret=<admin>&backfill=1[&pages=N][&pageToken=X][&maxPosts=40]
//        -> reply to UNREPLIED 4-5★ across older pages (bounded per call), returns
//           next_page_token to continue. Old 1-3★ are counted, never auto-posted.
'use strict';

const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const gbp = require('./_lib/gbp');
const { positiveReply, negativeReply } = require('./_lib/review-reply');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG = 3;
const OWNER = '+16154855795';
const STAR = { STAR_RATING_UNSPECIFIED: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function negSeen() {
  try {
    const rows = await crud.searchPage(EVENT_LOG, { action: 'review_autoreply_neg_seen' }, { id: 'desc' }, 1);
    const m = (rows && rows[0] && rows[0].metadata) || {};
    return new Set(m.keys || []);
  } catch (_) { return new Set(); }
}
async function saveNegSeen(set) {
  try { await crud.logEvent('review_autoreply_neg_seen', { keys: [...set].slice(-200), at_ms: Date.now() }); } catch (_) {}
}
async function textOwner(body, tag) {
  try {
    await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: OWNER, message: body, force_send: true, context_tag: tag }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {}
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const manual = !!q.secret;
  if (manual) {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  }
  const dry = q.dryrun === '1';

  if (!(await gbp.isConfigured())) return json(200, { ok: false, configured: false });

  // resolve account -> first location -> newest reviews (page 1)
  let acctId, locId;
  try {
    const a = await gbp.listAccounts();
    const accts = (a.data && a.data.accounts) || [];
    if (!accts.length) return json(200, { ok: false, error: 'no_accounts' });
    acctId = String(accts[0].name).replace(/^accounts\//, '');
    const loc = await gbp.listLocations(acctId);
    const locs = (loc.data && loc.data.locations) || [];
    if (!locs.length) return json(200, { ok: false, error: 'no_locations', data: loc.data });
    locId = String(locs[0].name).replace(/^locations\//, '');
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }

  // ── AUDIT / BACKFILL: walk older pages ──────────────────────────────────────
  // audit = count replied vs unreplied by star (no posts). backfill = reply to
  // UNREPLIED 4-5★ across older pages, bounded per call (returns next_page_token so
  // it can be looped). Old 1-3★ are counted + sampled for a human, NEVER auto-posted.
  const audit = q.audit === '1';
  const backfill = q.backfill === '1';
  if (audit || backfill) {
    const maxPages = Math.max(1, Math.min(25, parseInt(q.pages, 10) || (audit ? 10 : 3)));
    const maxPosts = Math.max(1, Math.min(60, parseInt(q.maxPosts, 10) || 40));
    let token = q.pageToken || '';
    let scanned = 0, replied = 0, unreplied_pos = 0, unreplied_neg = 0, unrated = 0, posted = 0, failed = 0, pages = 0, posIdx = 0, hitCap = false;
    const negs = [];
    for (let pg = 0; pg < maxPages; pg++) {
      const usedToken = token;
      const rr = await gbp.listReviews(acctId, locId, token || undefined);
      if (!rr.ok) return json(200, { ok: false, step: 'list_reviews', status: rr.status, data: rr.data, pages });
      const revs = (rr.data && rr.data.reviews) || [];
      for (const rv of revs) {
        scanned++;
        const stars = STAR[rv.starRating] || 0;
        if (rv.reviewReply) { replied++; continue; }
        if (stars >= 4) {
          unreplied_pos++;
          if (backfill) {
            if (posted >= maxPosts) { hitCap = true; break; }
            const r = { reviewer: (rv.reviewer && rv.reviewer.displayName) || 'A Google user', comment: rv.comment || '' };
            try { (await gbp.putReply(rv.name, positiveReply(r, posIdx++))).ok ? posted++ : failed++; } catch (_) { failed++; }
          }
        } else if (stars >= 1) {
          unreplied_neg++;
          if (negs.length < 15) negs.push({ stars, reviewer: (rv.reviewer && rv.reviewer.displayName) || '', comment: (rv.comment || '').slice(0, 140) });
        } else unrated++;
      }
      pages++;
      if (hitCap) { token = usedToken; break; }   // resume THIS page next run (replied ones now skip)
      token = (rr.data && rr.data.nextPageToken) || '';
      if (!token) break;
    }
    return json(200, { ok: true, mode: backfill ? 'backfill' : 'audit', pages, scanned, replied, unreplied_pos, unreplied_neg, unrated, posted, failed, next_page_token: token || null, done: !token, sample_negatives: negs });
  }

  const rev = await gbp.listReviews(acctId, locId);
  if (!rev.ok) return json(200, { ok: false, step: 'list_reviews', status: rev.status, data: rev.data });
  const reviews = (rev.data && rev.data.reviews) || [];

  const seen = await negSeen();
  let posted = 0, flagged = 0, posIdx = 0, failed = 0;
  const preview = [];

  for (const rv of reviews) {
    if (rv.reviewReply) continue;              // already has an owner reply
    const stars = STAR[rv.starRating] || 0;
    const r = { name: rv.name, reviewer: (rv.reviewer && rv.reviewer.displayName) || 'A Google user', comment: rv.comment || '' };

    if (stars >= 4) {
      const text = positiveReply(r, posIdx++);
      preview.push({ stars, reviewer: r.reviewer, action: 'auto-post', reply: text });
      if (!dry) {
        try { (await gbp.putReply(rv.name, text)).ok ? posted++ : failed++; }
        catch (_) { failed++; }
      }
    } else if (stars >= 1) {                    // 1-3 star: flag a human, never auto-post
      if (seen.has(rv.name)) continue;
      const draft = negativeReply(r);
      preview.push({ stars, reviewer: r.reviewer, action: 'flag-human', draft });
      if (!dry) {
        const body = `⭐ NEW ${stars}-STAR REVIEW — needs your touch\n${r.reviewer}${r.comment ? ('\n"' + r.comment.slice(0, 220) + '"') : ''}\n\nSuggested reply (edit before posting):\n"${draft}"\n\nRespond on your Google Business Profile.`;
        await textOwner(body, 'review_reply_urgent');
        seen.add(rv.name);
        flagged++;
      }
    }
    // stars === 0 (unspecified) -> leave for a human, do nothing
  }

  if (!dry && flagged) await saveNegSeen(seen);
  return json(200, { ok: true, dry, scanned: reviews.length, posted, flagged, failed, preview: preview.slice(0, 12) });
};
