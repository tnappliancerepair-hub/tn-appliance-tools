// build-social-tags.js — add Open Graph + Twitter Card meta to every page so
// links shared on Facebook / iMessage / X show a clean preview card instead of
// a bare URL. Derives og:title/description from each page's existing <title> and
// meta description; fills only the tags that are MISSING (so hand-authored OG is
// never duplicated). Idempotent via an ANT-SOCIAL marker.
//
// The share IMAGE is a single sitewide file — drop a 1200x630 JPG at
// /og-image.jpg and every page's preview lights up (no rebuild needed; FB
// re-scrapes). Until then, the title/description card still works.
//
// Run:  node tools/seo-build/build-social-tags.js
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SITE = 'https://tnapplianceexchange.net';
const OG_IMAGE = `${SITE}/og-image.jpg`;
const SITE_NAME = 'TN Appliance Exchange';

const files = fs.readdirSync(REPO).filter((f) => f.endsWith('.html'));
let changed = 0;

for (const f of files) {
  const fp = path.join(REPO, f);
  let html = fs.readFileSync(fp, 'utf8');

  // idempotent: strip our previous block, then re-evaluate gaps
  html = html.replace(/\n?\s*<!-- ANT-SOCIAL -->[\s\S]*?<!-- \/ANT-SOCIAL -->\n?/g, '\n');

  if (!/<\/title>/i.test(html)) continue; // need a title anchor

  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || SITE_NAME;
  const descM = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  const desc = descM ? descM[1] : 'Honest appliance help from TN Appliance Exchange.';
  const canM = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i);
  const url = canM ? canM[1] : `${SITE}/${f}`;
  const esc = (s) => String(s).replace(/"/g, '&quot;');

  const has = (re) => re.test(html);
  const tags = [];
  if (!has(/property="og:title"/i)) tags.push(`<meta property="og:title" content="${esc(title)}">`);
  if (!has(/property="og:description"/i)) tags.push(`<meta property="og:description" content="${esc(desc)}">`);
  if (!has(/property="og:type"/i)) tags.push(`<meta property="og:type" content="website">`);
  if (!has(/property="og:url"/i)) tags.push(`<meta property="og:url" content="${esc(url)}">`);
  if (!has(/property="og:site_name"/i)) tags.push(`<meta property="og:site_name" content="${SITE_NAME}">`);
  if (!has(/property="og:image"/i)) {
    tags.push(`<meta property="og:image" content="${OG_IMAGE}">`);
    tags.push(`<meta property="og:image:width" content="1200">`);
    tags.push(`<meta property="og:image:height" content="630">`);
  }
  if (!has(/name="twitter:card"/i)) tags.push(`<meta name="twitter:card" content="summary_large_image">`);
  if (!has(/name="twitter:title"/i)) tags.push(`<meta name="twitter:title" content="${esc(title)}">`);
  if (!has(/name="twitter:description"/i)) tags.push(`<meta name="twitter:description" content="${esc(desc)}">`);
  if (!has(/name="twitter:image"/i)) tags.push(`<meta name="twitter:image" content="${OG_IMAGE}">`);

  if (!tags.length) continue;

  const block = `\n<!-- ANT-SOCIAL -->\n${tags.join('\n')}\n<!-- /ANT-SOCIAL -->`;
  html = html.replace(/<\/title>/i, `</title>${block}`);
  fs.writeFileSync(fp, html, 'utf8');
  changed++;
}
console.log(`Social share tags ensured on ${changed} pages (share image: ${OG_IMAGE}).`);
