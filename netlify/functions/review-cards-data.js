// review-cards-data — owner-gated pool of the business's best Google reviews,
// shaped for the review-card studio (review-cards.html). Pulls from the
// authoritative Business Profile API (same source as gbp-reviews), keeps only
// 4-5★ reviews with substantive text, dedupes, and caches the pool in the vault
// so the studio loads instantly. GET ?secret=<VAPI_ADMIN_SECRET>[&refresh=1].
'use strict';

const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const gbp = require('./_lib/gbp');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

const STAR = { STAR_RATING_UNSPECIFIED: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const POOL_KEY = 'SOCIAL_REVIEW_CARD_POOL';
const MAX_PAGES = 5;                    // scan up to ~250 most-recent reviews
const MIN_LEN = 40;                     // skip "Great!" one-worders
const MAX_POOL = 120;                   // bound the cached payload size
const FRESH_MS = 6 * 60 * 60 * 1000;    // 6h cache

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  // Serve the cached pool unless a refresh is asked for or it's stale.
  if (q.refresh !== '1') {
    try {
      const cached = JSON.parse((await getSecretFresh(POOL_KEY)) || 'null');
      if (cached && cached.fetched_at && (Date.now() - cached.fetched_at) < FRESH_MS && Array.isArray(cached.pool) && cached.pool.length) {
        return json(200, Object.assign({}, cached, { cached: true }));
      }
    } catch (_) {}
  }

  if (!(await gbp.isConfigured())) return json(200, { ok: false, configured: false, note: 'authorize at /gbp-oauth-start' });

  let accountId, locationId;
  try { ({ accountId, locationId } = await gbp.resolveAccountLocation()); }
  catch (e) { return json(200, { ok: false, error: 'resolve_' + String((e && e.message) || e).slice(0, 120) }); }

  const seen = new Set();
  const pool = [];
  let average = null, total = null, pageToken = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    const rev = await gbp.listReviews(accountId, locationId, pageToken);
    if (!rev.ok) break;
    const d = rev.data || {};
    if (average == null && d.averageRating != null) average = d.averageRating;
    if (total == null && d.totalReviewCount != null) total = d.totalReviewCount;
    for (const rv of (d.reviews || [])) {
      const stars = STAR[rv.starRating] || 0;
      const text = (rv.comment || '').replace(/\s+/g, ' ').trim();
      if (stars < 4 || text.length < MIN_LEN) continue;
      const author = ((rv.reviewer && rv.reviewer.displayName) || 'A Google user').trim();
      const key = author + '|' + text.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({ author, stars, text, created: rv.createTime });
      if (pool.length >= MAX_POOL) break;
    }
    if (pool.length >= MAX_POOL) break;
    pageToken = d.nextPageToken || null;
    if (!pageToken) break;
  }

  const payload = {
    ok: true,
    stats: { average: average || 4.5, total: total || pool.length },
    count: pool.length,
    pool,
    fetched_at: Date.now(),
  };
  try { await setSecret(POOL_KEY, JSON.stringify(payload)); } catch (_) {}
  return json(200, Object.assign({}, payload, { cached: false }));
};
