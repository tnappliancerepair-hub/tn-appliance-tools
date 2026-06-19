// fix-ratings.js — normalize every AggregateRating across the site to TN
// Appliance Exchange's REAL Google numbers, from one source of truth.
//
// Why: 103 pages had a hardcoded, fabricated "4.6 / 323 reviews" (in two
// different spacings from two generators). Identical invented review counts
// across many pages is a classic review-spam manual-action trigger — and it
// under-sells the real 4.5★ / 1,000+ profile. This rewrites them all to the
// true aggregate, consistently. Honest + safer + stronger.
//
// When the live count lands (Places API New, get-google-reviews), pass it in:
//   RATING=4.5 REVIEWS=1043 node tools/seo-build/fix-ratings.js
//
// Idempotent — safe to re-run after any rebuild.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const RATING = process.env.RATING || '4.5';      // real Google rating
const REVIEWS = process.env.REVIEWS || '1000';   // honest floor of the 1,000+ count

const files = fs.readdirSync(REPO).filter((f) => f.endsWith('.html'));
let changed = 0;
let pages = 0;

for (const f of files) {
  const p = path.join(REPO, f);
  let html = fs.readFileSync(p, 'utf8');
  if (!/AggregateRating/.test(html)) continue;
  pages++;
  const before = html;
  // Handle both `"key":"v"` and `"key": "v"` spacings; any prior value.
  html = html
    .replace(/("ratingValue":\s*")[0-9.]+(")/g, `$1${RATING}$2`)
    .replace(/("reviewCount":\s*")[0-9]+(")/g, `$1${REVIEWS}$2`);
  if (html !== before) {
    fs.writeFileSync(p, html, 'utf8');
    changed++;
  }
}
console.log(`Ratings normalized → ${RATING}★ / ${REVIEWS} reviews on ${changed}/${pages} pages with AggregateRating.`);
