// gbp-review-autoreply — keep Google reviews caught up going forward.
// Scheduled: pulls the newest reviews, and for any WITHOUT a reply:
//   • 4-5 star  -> AUTO-POSTS a warm personalized reply (via the GBP API).
//   • 1-3 star  -> NEVER auto-posts. Texts Teddy the review + a ready draft so a
//                  real person handles it (the hard safety rule from day one).
// New reviews land at the top (orderBy updateTime desc), so page 1 is enough
// between runs. Positives dedup naturally (once replied, has_reply=true);
// negatives dedup via an event_log marker so Teddy isn't re-texted.
//
//   (scheduled)                      -> run
//   GET ?secret=<admin>[&dryrun=1]   -> manual run / preview (no posts, no texts)
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
