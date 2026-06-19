// build-reviews.js — bake real Google reviews (4–5★ only) onto the homepage as
// visible social proof, sourced live from the Places API (New) via our
// get-google-reviews function.
//
// Design choices (deliberate):
//   - We show ONLY positive (rating >= 4) reviews. Google's API returns "most
//     relevant" which can include 1-star complaints — never bake those onto the
//     site. The honest headline is the real AGGREGATE (4.5 / 1,079), which is
//     already in the homepage LocalBusiness schema.
//   - Visible HTML testimonials only — NO per-review Review structured data.
//     Google's guidelines discourage self-marking third-party (Google) reviews
//     as first-party Review schema; the business-level AggregateRating is the
//     safe, eligible markup and stays as-is.
//   - Idempotent via an ANT-REVIEWS marker (safe to re-run).
//
// Run:  node tools/seo-build/build-reviews.js
//       REVIEWS_URL=… node tools/seo-build/build-reviews.js   (override source)
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const URL = process.env.REVIEWS_URL || 'https://tnapplianceexchange.net/.netlify/functions/get-google-reviews';
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function main() {
  let data;
  try {
    const r = await fetch(URL);
    data = await r.json();
  } catch (e) {
    console.error('Could not fetch reviews:', e.message);
    process.exit(1);
  }
  if (!data || !data.ok) {
    console.error('Reviews source not ok:', data && (data.error || data.hint));
    process.exit(1);
  }

  const rating = data.rating || 4.5;
  const count = data.review_count || 1079;
  const mapsUrl = 'https://www.google.com/maps/place/?q=place_id:' + (data.place_id || '');
  const positive = (data.reviews || [])
    .filter((r) => (r.rating || 0) >= 4 && (r.text || '').trim().length > 30)
    .slice(0, 3);

  if (!positive.length) {
    console.error('No positive reviews returned — skipping (aggregate stays).');
    process.exit(0);
  }

  const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  const cards = positive.map((r) => {
    const txt = esc(r.text.length > 240 ? r.text.slice(0, 237).trim() + '…' : r.text);
    return `    <figure style="margin:0;background:#fff;border:1px solid #e6eaf0;border-radius:14px;padding:18px 18px 16px;box-shadow:0 1px 3px rgba(20,32,58,.05)">
      <div style="color:#f5a623;font-size:15px;letter-spacing:1px">${stars(r.rating)}</div>
      <blockquote style="margin:8px 0 12px;font-size:14px;line-height:1.55;color:#28324a">${txt}</blockquote>
      <figcaption style="font-size:13px;color:#6a7488"><strong>${esc(r.author || 'Verified customer')}</strong> · ${esc(r.relative_time || 'Google review')}</figcaption>
    </figure>`;
  }).join('\n');

  const block = `
<!-- ANT-REVIEWS -->
<section aria-label="Customer reviews" style="max-width:1040px;margin:8px auto 0;padding:30px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:16px">
    <h2 style="font-size:22px;color:#12203a;margin:0">What our customers say</h2>
    <a href="${mapsUrl}" target="_blank" rel="noopener" style="text-decoration:none;color:#6a7488;font-size:14px">
      <strong style="color:#f5a623">★ ${rating}</strong> · ${Number(count).toLocaleString()}+ Google reviews</a>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
${cards}
  </div>
  <p style="margin:16px 0 0"><a href="${mapsUrl}" target="_blank" rel="noopener" style="color:#1f6fed;text-decoration:none;font-size:14px;font-weight:600">Read all ${Number(count).toLocaleString()}+ reviews on Google →</a></p>
</section>
<!-- /ANT-REVIEWS -->
`;

  const p = path.join(REPO, 'index.html');
  let html = fs.readFileSync(p, 'utf8');
  html = html.replace(/\n?<!-- ANT-REVIEWS -->[\s\S]*?<!-- \/ANT-REVIEWS -->\n?/g, ''); // idempotent
  if (html.includes('</body>')) html = html.replace('</body>', block + '\n</body>');
  else html += block;
  fs.writeFileSync(p, html, 'utf8');
  console.log(`Baked ${positive.length} reviews (>=4★) onto homepage. Aggregate ${rating}/${count}.`);
}
main();
