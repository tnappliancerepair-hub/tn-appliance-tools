#!/usr/bin/env node
/* seo-rollout — Phase A across all marketing pages (idempotent, additive-only):
 *   1) contextual Ant launcher (sticky $50-Quick-Check CTA -> appliance-ai)
 *   2) hub-and-spoke internal interlinks (only to pages that exist)
 *   3) FAQPage JSON-LD schema (true Q&As tied to the page)
 * Injects one block before </body>, marked so re-runs skip. DRY_RUN=1 to preview.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DRY = process.env.DRY_RUN === '1';
const MARK = '<!-- ant-seo-rollout v1 -->';

const TOWNS_TN = ['antioch','brentwood','clarksville','franklin','gallatin','hendersonville','la-vergne','lebanon','murfreesboro','nashville','smyrna','spring-hill'];
const TOWNS_LA = ['baton-rouge','chalmette','covington','denham-springs','gonzales','hammond','kenner','laplace','madisonville','mandeville','metairie','new-orleans','pearl-river','ponchatoula','pumpkin-center','slidell','walker'];
const TOWNS = TOWNS_TN.concat(TOWNS_LA);
const BRANDS = ['whirlpool','samsung','lg','ge','maytag','frigidaire','electrolux','kenmore','bosch','amana','kitchenaid'];
const APPLIANCES = ['refrigerator','washer','dryer','dishwasher','freezer','oven','range','stove','microwave'];
const BRAND_CAP = { whirlpool:'Whirlpool', samsung:'Samsung', lg:'LG', ge:'GE', maytag:'Maytag', frigidaire:'Frigidaire', electrolux:'Electrolux', kenmore:'Kenmore', bosch:'Bosch', amana:'Amana', kitchenaid:'KitchenAid' };
const titleCase = (s) => s.split('-').map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(' ');

const allFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const exists = (f) => allFiles.includes(f);

// is this a marketing page we should touch?
function classify(file) {
  const base = file.replace(/\.html$/,'');
  if (TOWNS.includes(base)) return { type:'town', town:base };
  // brand-appliance-repair  e.g. samsung-refrigerator-repair
  let m = base.match(/^([a-z]+)-([a-z]+)-repair$/);
  if (m && BRANDS.includes(m[1]) && APPLIANCES.includes(m[2])) return { type:'brand_appliance', brand:m[1], appliance:m[2] };
  // brand-appliance-repair generic e.g. whirlpool-appliance-repair
  m = base.match(/^([a-z]+)-appliance-repair$/);
  if (m && BRANDS.includes(m[1])) return { type:'brand', brand:m[1] };
  // appliance-repair e.g. refrigerator-repair
  m = base.match(/^([a-z]+)-repair$/);
  if (m && APPLIANCES.includes(m[1])) return { type:'appliance', appliance:m[1] };
  // symptom e.g. dishwasher-not-cleaning, washer-wont-start, oven-not-heating, ice-maker-not-working
  m = base.match(/^([a-z-]+)-(not|wont|won-t|making|door)-/);
  if (m) { const first = base.split('-')[0]; const appl = APPLIANCES.includes(first) ? first : (base.startsWith('ice-maker') ? 'refrigerator' : (base.startsWith('garbage-disposal') ? 'dishwasher' : (base.startsWith('gas-range') ? 'range' : (base.startsWith('stove') ? 'range' : '')))); return { type:'symptom', appliance: appl, slug: base }; }
  return null;
}

function ctxAttr(c) {
  const o = {};
  if (c.brand) o.brand = BRAND_CAP[c.brand];
  if (c.appliance) o.appliance = c.appliance;
  if (c.town) o.town = titleCase(c.town);
  return o;
}
function pick(arr, n, exclude) { return arr.filter(x => x !== exclude && exists(x)).slice(0, n); }
function link(file, label) { return `<a href="/${file}" style="color:#ff6200;text-decoration:none;border:1px solid #252525;border-radius:8px;padding:7px 12px;font-size:13px;display:inline-block">${label}</a>`; }

// build the related-links set (capped, only existing pages)
function relatedLinks(c) {
  const out = [];
  if (c.type === 'town') {
    const sameState = (TOWNS_TN.includes(c.town) ? TOWNS_TN : TOWNS_LA);
    pick(sameState.map(t=>t+'.html'), 5, c.town+'.html').forEach(f => out.push(link(f, titleCase(f.replace('.html',''))+' Repair')));
    ['refrigerator-repair.html','washer-repair.html','dryer-repair.html','dishwasher-repair.html'].forEach(f => exists(f) && out.push(link(f, titleCase(f.replace('-repair.html',''))+' Repair')));
  } else if (c.type === 'brand_appliance') {
    APPLIANCES.forEach(a => { const f = `${c.brand}-${a}-repair.html`; if (a!==c.appliance && exists(f)) out.push(link(f, `${BRAND_CAP[c.brand]} ${titleCase(a)}`)); });
    [`${c.appliance}-repair.html`, `${c.brand}-appliance-repair.html`].forEach(f => exists(f) && out.push(link(f, titleCase(f.replace('.html','').replace(/-/g,' ')))));
    pick(['hammond.html','nashville.html','baton-rouge.html','clarksville.html'],3).forEach(f=>out.push(link(f, titleCase(f.replace('.html',''))+' Repair')));
  } else if (c.type === 'brand') {
    APPLIANCES.forEach(a => { const f = `${c.brand}-${a}-repair.html`; if (exists(f)) out.push(link(f, `${BRAND_CAP[c.brand]} ${titleCase(a)}`)); });
  } else if (c.type === 'appliance') {
    BRANDS.forEach(b => { const f = `${b}-${c.appliance}-repair.html`; if (exists(f)) out.push(link(f, `${BRAND_CAP[b]} ${titleCase(c.appliance)}`)); });
  } else if (c.type === 'symptom') {
    if (c.appliance && exists(`${c.appliance}-repair.html`)) out.push(link(`${c.appliance}-repair.html`, `${titleCase(c.appliance)} Repair`));
    allFiles.filter(f => c.appliance && f.startsWith(c.appliance+'-') && /-(not|wont|making|door)-/.test(f) && f !== c.slug+'.html').slice(0,3).forEach(f => out.push(link(f, titleCase(f.replace('.html','').replace(/-/g,' ')))));
  }
  // every page: a few towns + the home
  pick(['hammond.html','nashville.html','metairie.html','murfreesboro.html'],2).forEach(f=>out.push(link(f, titleCase(f.replace('.html',''))+' Repair')));
  return Array.from(new Set(out)).slice(0, 12);
}

function faqLd(c) {
  const what = c.brand && c.appliance ? `${BRAND_CAP[c.brand]} ${c.appliance}` : (c.brand ? BRAND_CAP[c.brand]+' appliance' : (c.appliance ? c.appliance : 'appliance'));
  const where = c.town ? ` in ${titleCase(c.town)}` : '';
  const qa = [
    [`How much does ${what} repair cost${where}?`, `It starts with our $50 Quick Check — an honest diagnosis you can do from your phone, credited toward your repair if you proceed. Most shops charge $125–150 just to show up.`],
    [`How fast can you help with my ${what}${where}?`, `Send a 10-second video and a photo of the model number through our appliance AI and you'll get an honest assessment and your repair options within 2 business hours.`],
    [`What if my ${what} isn't worth fixing?`, `We'll tell you honestly. The $50 Quick Check gives you a straight answer either way — including "don't fix it" — so you never waste money on a repair that doesn't make sense.`],
  ];
  return JSON.stringify({ '@context':'https://schema.org','@type':'FAQPage', mainEntity: qa.map(([q,a])=>({'@type':'Question',name:q,acceptedAnswer:{'@type':'Answer',text:a}})) });
}

function block(c, hasLauncher) {
  const ctx = ctxAttr(c);
  const links = relatedLinks(c).join(' ');
  const launcher = hasLauncher ? '' : `<script>window.ANT_CTX=${JSON.stringify(ctx)};</script>\n<script src="/ant-launcher.js" defer></script>`;
  return `
${MARK}
<section style="max-width:760px;margin:40px auto 24px;padding:20px;border-top:1px solid #1a1a1a;font-family:'Geist Mono',ui-monospace,monospace">
  <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#ff6200;margin-bottom:10px">Related repairs &amp; areas we serve</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px">${links}</div>
  <div style="margin-top:16px"><a href="/appliance-ai.html${Object.keys(ctx).length?('?'+Object.entries(ctx).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&')):''}" style="color:#f0f0f0;font-weight:600;text-decoration:none">🐜 Talk to the Appliance AI &rarr; honest answer in hours, $50 Quick Check</a></div>
</section>
<script type="application/ld+json">${faqLd(c)}</script>
${launcher}
`;
}

let touched = 0, skipped = 0, ignored = 0;
const report = [];
for (const f of allFiles) {
  const c = classify(f);
  if (!c) { ignored++; continue; }
  const p = path.join(ROOT, f);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes(MARK)) { skipped++; continue; }
  if (!html.includes('</body>')) { ignored++; continue; }
  const inj = block(c, html.includes("ant-launcher.js"));
  report.push(`${f}  [${c.type}]  ctx=${JSON.stringify(ctxAttr(c))}  links=${relatedLinks(c).length}`);
  if (!DRY) { fs.writeFileSync(p, html.replace('</body>', inj + '\n</body>')); }
  touched++;
}
console.log((DRY?'DRY-RUN — ':'') + `would touch ${touched}, skipped(already) ${skipped}, ignored(non-marketing) ${ignored}`);
console.log(report.slice(0, 12).join('\n'));
if (report.length > 12) console.log(`… +${report.length-12} more`);
