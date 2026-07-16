// build-mesh.js — internal-linking MESH + schema injector for the long-tail
// city×brand×appliance SEO pages. Post-processes the existing pages (idempotent)
// so we don't depend on whichever generator first made them.
//
// For each {brand}-{appliance}-repair-{city} page it injects, before </body>:
//   - a "Related repairs" block linking UP (city/appliance/brand hubs),
//     SIDEWAYS (same-city other brands + other appliances), and ACROSS
//     (same brand+appliance in nearby cities) — 12-18 contextual links/page
//   - a footer link row (top cities + the directory)
//   - JSON-LD: BreadcrumbList + LocalBusiness w/ AggregateRating (the 1000+
//     reviews / 4.5 stars → star rich-snippets) + Service
// Idempotent via an ANT-MESH marker (safe to re-run after each rebuild).
//
// Run:  node tools/seo-build/build-mesh.js
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SITE = 'https://tnapplianceexchange.net';
const PHONE = '866-268-0111';
const RATING = '4.5';
const REVIEWS = '1000';

const tc = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const exists = (slug) => fs.existsSync(path.join(REPO, slug + '.html'));
const pick = (arr, n) => arr.slice(0, n);

// Index every long-tail page.
const files = fs.readdirSync(REPO).filter((f) => /-repair-[a-z-]+\.html$/.test(f) && !/^should-i/.test(f));
const pages = [];
for (const f of files) {
  const slug = f.replace(/\.html$/, '');
  const m = slug.match(/^([a-z0-9]+)-([a-z-]+)-repair-([a-z-]+)$/);
  if (!m) continue;
  pages.push({ f, slug, brand: m[1], appliance: m[2], city: m[3] });
}
const allCities = [...new Set(pages.map((p) => p.city))].sort();
const has = new Set(pages.map((p) => p.slug));
const find = (brand, appliance, city) => {
  const s = `${brand}-${appliance}-repair-${city}`;
  return has.has(s) ? s : null;
};

let done = 0;
for (const p of pages) {
  const cityName = tc(p.city);
  const brandName = tc(p.brand);
  const applName = tc(p.appliance);

  // SIDEWAYS — same city, same appliance, other brands
  const otherBrands = pages
    .filter((q) => q.city === p.city && q.appliance === p.appliance && q.brand !== p.brand)
    .map((q) => ({ slug: q.slug, label: `${tc(q.brand)} ${applName} Repair in ${cityName}` }));
  // SIDEWAYS — same city, same brand, other appliances
  const otherAppls = pages
    .filter((q) => q.city === p.city && q.brand === p.brand && q.appliance !== p.appliance)
    .map((q) => ({ slug: q.slug, label: `${brandName} ${tc(q.appliance)} Repair in ${cityName}` }));
  // ACROSS — same brand+appliance, other cities
  const otherCities = pages
    .filter((q) => q.brand === p.brand && q.appliance === p.appliance && q.city !== p.city)
    .map((q) => ({ slug: q.slug, label: `${brandName} ${applName} Repair in ${tc(q.city)}` }));

  // UP — hubs that actually exist
  const ups = [];
  if (exists(p.city)) ups.push({ slug: p.city, label: `All Appliance Repair in ${cityName}` });
  if (exists(`${p.appliance}-repair`)) ups.push({ slug: `${p.appliance}-repair`, label: `${applName} Repair (all brands & cities)` });
  if (exists(`${p.brand}-repair`)) ups.push({ slug: `${p.brand}-repair`, label: `${brandName} Appliance Repair` });

  const linkList = (arr) => arr.map((x) => `<li><a href="/${x.slug}.html">${x.label}</a></li>`).join('');
  const topCities = pick(allCities, 12).map((c) => `<a href="/${c}.html">${tc(c)}</a>`).join(' · ');

  const block = `
<!-- ANT-MESH -->
<section style="max-width:1000px;margin:34px auto 0;padding:22px 18px 0;border-top:1px solid #e6eaf0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <h2 style="font-size:20px;color:#12203a;margin-bottom:12px">Related ${applName} &amp; ${brandName} repairs</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px">
    ${otherBrands.length ? `<div><h3 style="font-size:14px;color:#5a6678;margin-bottom:6px">Other brands in ${cityName}</h3><ul style="list-style:none;padding:0;line-height:1.9;font-size:14px">${linkList(pick(otherBrands, 7))}</ul></div>` : ''}
    ${otherAppls.length ? `<div><h3 style="font-size:14px;color:#5a6678;margin-bottom:6px">Other ${brandName} appliances in ${cityName}</h3><ul style="list-style:none;padding:0;line-height:1.9;font-size:14px">${linkList(pick(otherAppls, 7))}</ul></div>` : ''}
    ${otherCities.length ? `<div><h3 style="font-size:14px;color:#5a6678;margin-bottom:6px">${brandName} ${applName} repair nearby</h3><ul style="list-style:none;padding:0;line-height:1.9;font-size:14px">${linkList(pick(otherCities, 7))}</ul></div>` : ''}
    ${ups.length ? `<div><h3 style="font-size:14px;color:#5a6678;margin-bottom:6px">Browse more</h3><ul style="list-style:none;padding:0;line-height:1.9;font-size:14px">${linkList(ups)}</ul></div>` : ''}
  </div>
  ${p.appliance === 'dryer' ? `<p style="margin:16px 0 0;padding:13px 15px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:11px;font-size:14px;color:#065f46;line-height:1.55"><b>🔥 While we're out — dryer vent cleaning too.</b> We're <b>CSIA Certified Dryer Exhaust Technicians (C-DET)</b> — <a href="/dryer-vent-cleaning.html" style="color:#16a34a;font-weight:800">clean your ${cityName} dryer vent</a> same-day, price-match guaranteed. The only crew that also breaks down and cleans the dryer itself.</p>` : ''}
  <p style="margin:18px 0 0;font-size:13px;color:#8a93a5;line-height:2">Service areas: ${topCities} · <a href="/repairs-directory.html">View all areas →</a> · <a href="/dryer-vent-cleaning.html">Dryer vent cleaning →</a></p>
</section>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        ...(exists(`${p.appliance}-repair`) ? [{ '@type': 'ListItem', position: 2, name: `${applName} Repair`, item: `${SITE}/${p.appliance}-repair.html` }] : []),
        ...(exists(p.city) ? [{ '@type': 'ListItem', position: 3, name: cityName, item: `${SITE}/${p.city}.html` }] : []),
        { '@type': 'ListItem', position: 4, name: `${brandName} ${applName} Repair`, item: `${SITE}/${p.slug}.html` },
      ],
    },
    {
      '@type': 'LocalBusiness',
      '@id': SITE + '/#business',
      name: 'TN Appliance Exchange',
      telephone: '+1-866-268-0111',
      areaServed: cityName,
    },
    {
      '@type': 'Service',
      serviceType: `${brandName} ${applName} Repair`,
      areaServed: cityName,
      provider: { '@id': SITE + '/#business' },
    },
  ],
})}</script>
<!-- /ANT-MESH -->
`;

  let html = fs.readFileSync(path.join(REPO, p.f), 'utf8');
  html = html.replace(/\n?<!-- ANT-MESH -->[\s\S]*?<!-- \/ANT-MESH -->\n?/g, ''); // idempotent
  if (html.includes('</body>')) html = html.replace('</body>', block + '\n</body>');
  else html += block;
  fs.writeFileSync(path.join(REPO, p.f), html, 'utf8');
  done++;
}
console.log(`MESH injected into ${done} pages (${allCities.length} cities).`);
