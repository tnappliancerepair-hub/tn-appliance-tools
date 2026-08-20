#!/usr/bin/env node
/* strengthen-hubs-2026-08-20 — internal-link authority for the pages the SEO scorecard
 * flagged ranking #23-40 with impressions but zero clicks (Teddy 2026-08-20 SEO check):
 *   "dryer repair" #23, "dishwasher repair" #25, and the Mandeville cluster
 *   (appliance/dryer/dishwasher/bosch repair mandeville #25-27).
 *
 * The pages themselves are content-rich; what they LACKED was hub->spoke linking, so
 * no authority flowed down to the exact city/brand pages that rank deep:
 *   • dryer-repair.html linked to 0 of its 31 dryer-repair-{city} landers.
 *   • dishwasher-repair.html linked to only 3 of 31.
 *   • mandeville.html linked to 0 of its 35 {brand}-{appliance}-repair-mandeville landers.
 *
 * This injects marked, native-styled link clusters (idempotent — skips if the marker is
 * already present) and bumps the three pages' sitemap <lastmod> for a freshness signal.
 * No new repair advice — pure internal-link plumbing + a fresh-date nudge.
 *   Run: node tools/seo-build/strengthen-hubs-2026-08-20.js   (DRY_RUN=1 to preview)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const DRY = process.env.DRY_RUN === '1';
const DATE = '2026-08-20';

const files = new Set(fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')));

// ── labels ──────────────────────────────────────────────────────────────────
const CITY_OVERRIDE = {
  'la-vergne': 'La Vergne', 'mt-juliet': 'Mt. Juliet', 'baton-rouge': 'Baton Rouge',
  'new-orleans': 'New Orleans', 'laplace': 'LaPlace', 'pearl-river': 'Pearl River',
  'denham-springs': 'Denham Springs', 'spring-hill': 'Spring Hill', 'pumpkin-center': 'Pumpkin Center',
};
const cityLabel = (slug) => CITY_OVERRIDE[slug] || slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const BRAND_CAP = { whirlpool: 'Whirlpool', samsung: 'Samsung', lg: 'LG', ge: 'GE', maytag: 'Maytag', frigidaire: 'Frigidaire', kenmore: 'Kenmore' };
const APP_LABEL = { refrigerator: 'Refrigerator', washer: 'Washer', dryer: 'Dryer', dishwasher: 'Dishwasher', oven: 'Oven &amp; Range' };
const APP_ORDER = ['refrigerator', 'washer', 'dryer', 'dishwasher', 'oven'];

let touched = 0;

// ── 1) flagship service hubs: "{Appliance} Repair by City" cluster ────────────
function strengthenFlagship(appliance, applianceLabel) {
  const file = `${appliance}-repair.html`;
  const fp = path.join(ROOT, file);
  if (!files.has(file)) { console.log(`  skip ${file} — not found`); return; }
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes('<!-- CITYMESH -->')) { console.log(`  ${file}: CITYMESH already present — skip`); return; }

  // every existing {appliance}-repair-{city}.html lander (city pages only — brand pages
  // start with a brand prefix so this regex never catches them)
  const re = new RegExp(`^${appliance}-repair-([a-z-]+)\\.html$`);
  const towns = [...files].map((f) => (f.match(re) || [])[1]).filter(Boolean)
    .map((slug) => ({ slug, label: cityLabel(slug) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!towns.length) { console.log(`  ${file}: no city landers found — skip`); return; }

  const chips = towns.map((t) => `<a href="/${appliance}-repair-${t.slug}.html" class="city-tag">${applianceLabel} Repair &middot; ${t.label}</a>`).join('');
  const block = `<!-- CITYMESH -->
<div class="section">
<div class="section-label">By City</div>
<h2>${applianceLabel} Repair by City</h2>
<p class="prose">Same-day ${applianceLabel.toLowerCase()} repair with the honest 4-option Technician Decision Report — jump straight to your city:</p>
<div class="cities-tag">${chips}</div>
</div>

`;
  // inject in-content, right before the "Other Appliances We Repair" section
  const anchor = '<div class="section">\n<div class="section-label">Other Appliances We Repair</div>';
  if (!html.includes(anchor)) { console.log(`  ${file}: anchor not found — skip`); return; }
  html = html.replace(anchor, block + anchor);
  if (!DRY) fs.writeFileSync(fp, html);
  console.log(`  ${file}: +CITYMESH (${towns.length} city links)`);
  touched++;
}

// ── 2) Mandeville hub: "Mandeville appliance repair by brand" cluster ─────────
function strengthenMandeville() {
  const file = 'mandeville.html';
  const fp = path.join(ROOT, file);
  if (!files.has(file)) { console.log(`  skip ${file} — not found`); return; }
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes('<!-- BBYBRAND -->')) { console.log(`  ${file}: BBYBRAND already present — skip`); return; }

  const rows = [];
  let linkCount = 0;
  for (const brand of Object.keys(BRAND_CAP)) {
    const links = APP_ORDER
      .filter((a) => files.has(`${brand}-${a}-repair-mandeville.html`))
      .map((a) => `<a href="/${brand}-${a}-repair-mandeville.html" class="related-link">${APP_LABEL[a]} &middot; Mandeville</a>`);
    if (!links.length) continue;
    linkCount += links.length;
    rows.push(`<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#ff6200;margin:14px 0 8px">${BRAND_CAP[brand]}</div>\n<div class="deep-related-grid">${links.join('')}</div>`);
  }
  if (!rows.length) { console.log(`  ${file}: no brand landers found — skip`); return; }

  const block = `<!-- BBYBRAND --><h2 style="font-family:var(--block);font-size:clamp(28px,5vw,40px);letter-spacing:.04em;line-height:1.1;margin:30px 0 14px;color:var(--white)">Mandeville appliance repair by brand</h2><p style="color:var(--gray,#888);font-size:14px;line-height:1.7;margin-bottom:14px">Whirlpool, Samsung, LG, GE, Maytag, Frigidaire, Kenmore — we repair every major brand on the North Shore, and Bosch too. Go straight to yours:</p>\n${rows.join('\n')}`;

  const anchor = '<a href="/oven-repair-mandeville.html" class="related-link">Oven &amp; Range Repair &middot; Mandeville</a></div>';
  if (!html.includes(anchor)) { console.log(`  ${file}: anchor not found — skip`); return; }
  html = html.replace(anchor, anchor + block);
  if (!DRY) fs.writeFileSync(fp, html);
  console.log(`  ${file}: +BBYBRAND (${linkCount} brand links)`);
  touched++;
}

// ── 3) sitemap freshness ──────────────────────────────────────────────────────
function bumpSitemap() {
  const fp = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(fp)) { console.log('  sitemap.xml not found — skip'); return; }
  let xml = fs.readFileSync(fp, 'utf8');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let n = 0;
  for (const p of ['dryer-repair', 'dishwasher-repair', 'mandeville']) {
    const loc = `<loc>https://tnapplianceexchange.net/${p}</loc>`;
    if (!xml.includes(loc)) { console.log(`  sitemap: no <loc> for /${p}`); continue; }
    if (new RegExp(esc(loc) + '\\s*<lastmod>').test(xml)) {
      // existing lastmod in this block -> update it
      xml = xml.replace(new RegExp('(' + esc(loc) + '\\s*<lastmod>)[^<]*(</lastmod>)'), `$1${DATE}$2`);
    } else {
      // no lastmod on this url -> insert one right after <loc>
      xml = xml.replace(loc, `${loc}\n    <lastmod>${DATE}</lastmod>`);
    }
    n++;
  }
  if (!DRY && n) fs.writeFileSync(fp, xml);
  console.log(`  sitemap: bumped ${n}/3 lastmod -> ${DATE}`);
}

console.log(DRY ? 'DRY RUN — no writes\n' : 'Strengthening hubs\n');
strengthenFlagship('dryer', 'Dryer');
strengthenFlagship('dishwasher', 'Dishwasher');
strengthenMandeville();
bumpSitemap();
console.log(`\nDone. Pages touched: ${touched}`);
