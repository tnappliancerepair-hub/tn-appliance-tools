// review-card-poster-cron — thin scheduled wrapper for review-card-poster.
//
// SPLIT ON PURPOSE. A Netlify function carrying its own `schedule` block edge-403s on
// every external HTTP call, which killed review-card-poster's own documented
// "?dry=1 -> preview the next card + caption, no post" path. That preview is the only
// safe way to eyeball a card before turning the engine loose on a page with 6,128
// followers, so with it unreachable the LIVE flag never got flipped and 120 queued
// cards posted nothing. Core stays curlable; this fires it in-process.
//
// Daily. Still idles unless SOCIAL_REVIEW_CARDS_LIVE=true -- that gate lives in the
// core and is unchanged.
'use strict';

const { runReviewCardPost } = require('./review-card-poster');

exports.config = { timeout: 26 };
exports.handler = async function () {
  try { return await runReviewCardPost({ scheduled: true }); }
  catch (e) {
    return { statusCode: 200, headers: { 'content-type': 'application/json' },
             body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
