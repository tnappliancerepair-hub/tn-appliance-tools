// gbp-reviews — read Google reviews + post owner replies (owner-gated).
// Built 2026-07-10 to catch the review backlog up.
//
//   GET  ?secret=<admin>[&account=..&location=..]   -> lists reviews across the
//        account's locations, flagged reply/no-reply + star rating.
//   POST ?secret=<admin>  { review_name, comment }  -> post/replace owner reply.
//
// SAFETY: this endpoint just moves data; the caller (Claude) decides what to
// post. Rule held everywhere: never put a personal cell in a reply.
'use strict';
const { getSecret } = require('./_lib/secrets');
const gbp = require('./_lib/gbp');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }

const STAR = { STAR_RATING_UNSPECIFIED: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const secret = q.secret || (() => { try { return JSON.parse(event.body || '{}').secret; } catch (_) { return ''; } })();
  if (secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  if (!(await gbp.isConfigured())) return json(200, { ok: false, configured: false, note: 'authorize at /gbp-oauth-start' });

  // POST -> reply to a review
  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
    if (!b.review_name || !b.comment) return json(400, { ok: false, error: 'review_name + comment required' });
    const r = await gbp.putReply(b.review_name, String(b.comment));
    return json(200, { ok: r.ok, status: r.status, data: r.data });
  }

  // GET -> resolve account, walk locations, list reviews
  try {
    let account = q.account;
    if (!account) {
      const a = await gbp.listAccounts();
      const accts = (a.data && a.data.accounts) || [];
      if (!accts.length) return json(200, { ok: false, error: 'no_accounts', raw: a.data });
      account = accts[0].name; // "accounts/123"
    }
    const acctId = String(account).replace(/^accounts\//, '');

    let locations = [];
    if (q.location) {
      locations = [{ name: 'locations/' + String(q.location).replace(/^locations\//, ''), title: '(specified)' }];
    } else {
      const loc = await gbp.listLocations(acctId);
      if (!loc.ok) return json(200, { ok: false, step: 'list_locations', status: loc.status, data: loc.data });
      locations = (loc.data && loc.data.locations) || [];
    }

    const out = [];
    for (const l of locations) {
      const locId = String(l.name).replace(/^locations\//, '');
      const rev = await gbp.listReviews(acctId, locId, q.page_token);
      if (!rev.ok) { out.push({ location: l.title || locId, location_id: locId, error: rev.status, data: rev.data }); continue; }
      const reviews = (rev.data && rev.data.reviews) || [];
      out.push({
        location: l.title || locId,
        location_id: locId,
        average: rev.data && rev.data.averageRating,
        total: rev.data && rev.data.totalReviewCount,
        next_page_token: (rev.data && rev.data.nextPageToken) || null,
        reviews: reviews.map((rv) => ({
          name: rv.name,
          reviewer: (rv.reviewer && rv.reviewer.displayName) || 'A Google user',
          stars: STAR[rv.starRating] || 0,
          comment: rv.comment || '',
          created: rv.createTime,
          has_reply: !!rv.reviewReply,
          reply: rv.reviewReply && rv.reviewReply.comment,
        })),
      });
    }
    return json(200, { ok: true, account: 'accounts/' + acctId, locations: out });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
};
