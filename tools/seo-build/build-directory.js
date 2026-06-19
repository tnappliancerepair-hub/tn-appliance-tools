// build-directory.js — generates repairs-directory.html: an HTML "hub" that
// links to every city×brand×appliance SEO page, grouped by city. This solves
// the orphan-page problem — without it, those ~1,160 pages have no internal
// links and Google won't crawl/index them. The homepage links here; here links
// to every page. One-click reachability = the pages can finally get indexed.
//
// Run:  node tools/seo-build/build-directory.js
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SITE = 'https://tnapplianceexchange.net';

const titleCase = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Parse every {brand}-{appliance}-repair-{city}.html into {brand, appliance, city, slug}.
const files = fs.readdirSync(REPO)
  .filter((f) => /-repair-[a-z-]+\.html$/.test(f) && !/^should-i/.test(f));

const byCity = {};
for (const f of files) {
  const slug = f.replace(/\.html$/, '');
  const m = slug.match(/^(.*)-repair-([a-z-]+)$/);
  if (!m) continue;
  const left = m[1];          // brand-appliance(-parts)
  const city = m[2];          // city (may contain hyphens)
  const parts = left.split('-');
  const brand = parts[0];
  const appliance = parts.slice(1).join(' ') || 'appliance';
  const label = `${titleCase(brand)} ${titleCase(appliance)}`;
  (byCity[city] = byCity[city] || []).push({ slug, label });
}

const cities = Object.keys(byCity).sort();
let total = 0;

const sections = cities.map((city) => {
  const items = byCity[city].sort((a, b) => a.label.localeCompare(b.label));
  total += items.length;
  const links = items.map((i) => `<li><a href="/${i.slug}.html">${i.label} Repair in ${titleCase(city)}</a></li>`).join('');
  return `<section class="city-block">
    <h2 id="${city}"><a href="/${city}.html">${titleCase(city)}</a></h2>
    <ul class="link-grid">${links}</ul>
  </section>`;
}).join('\n');

const cityNav = cities.map((c) => `<a href="#${c}">${titleCase(c)}</a>`).join(' · ');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Appliance Repair Service Areas & Directory | TN Appliance Exchange</title>
<meta name="description" content="Every appliance + brand we repair across Middle Tennessee and Southeast Louisiana — washers, dryers, refrigerators, dishwashers, ranges and more, by city. Honest video diagnosis, real techs.">
<link rel="canonical" href="${SITE}/repairs-directory.html">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a2230;line-height:1.5;background:#fff}
  .wrap{max-width:1000px;margin:0 auto;padding:28px 18px 60px}
  h1{font-size:30px;margin-bottom:6px}
  .sub{color:#5a6678;font-size:16px;margin-bottom:18px}
  .cta{display:inline-block;background:#1f6fed;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:10px;margin:4px 8px 18px 0}
  .citynav{font-size:13px;color:#5a6678;margin-bottom:26px;line-height:2}
  .citynav a{color:#1f6fed;text-decoration:none}
  .city-block{margin:26px 0;border-top:1px solid #e6eaf0;padding-top:16px}
  .city-block h2{font-size:21px;margin-bottom:10px}
  .city-block h2 a{color:#12203a;text-decoration:none}
  .link-grid{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:4px 18px}
  .link-grid a{color:#27508c;text-decoration:none;font-size:14px}
  .link-grid a:hover{text-decoration:underline}
  footer{margin-top:40px;color:#8a93a5;font-size:13px;text-align:center}
  footer a{color:#1f6fed;text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <h1>Appliance Repair — Service Areas & Directory</h1>
  <p class="sub">Honest, technician-led appliance repair across Middle Tennessee &amp; Southeast Louisiana. Pick your city and appliance below, or start a $50 Quick Check.</p>
  <a class="cta" href="/#chat">🐜 Start the Quick Check — $50</a>
  <a class="cta" style="background:#fff;color:#1f6fed;border:1px solid #1f6fed" href="tel:8662680111">📞 Call 866-268-0111</a>

  <div class="citynav">${cityNav}</div>

  ${sections}

  <footer>
    <a href="/">← TN Appliance Exchange home</a> · Serving Middle TN &amp; Southeast LA · <a href="tel:8662680111">866-268-0111</a>
  </footer>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(REPO, 'repairs-directory.html'), html, 'utf8');
console.log(`Wrote repairs-directory.html — ${cities.length} cities, ${total} repair pages linked`);
