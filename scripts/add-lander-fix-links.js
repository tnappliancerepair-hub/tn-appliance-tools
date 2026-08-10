// add-lander-fix-links.js — idempotent internal-linking booster.
// Injects a "Fix it yourself" block into each {appliance}-repair-{town}.html
// (and {brand}-{appliance}-repair-{town}.html) city lander, pointing at the
// most relevant /fix/ guides + the /fix/ hub + the /error-codes.html hub.
// This funnels internal link equity from the ~1,170 city landers (the biggest
// page footprint on the site) into the conversion content and the two hubs.
//
// SAFE: MARK-guarded (re-runs are no-ops), never regenerates pages, never
// touches sitemap.xml. Run:  node scripts/add-lander-fix-links.js [--apply]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const MARK = '<!-- FIXGUIDES -->';

// appliance -> top universal fix guides (must be real slugs in /fix/)
const UNIVERSAL = {
  dryer: [['dryer-not-heating', 'Not heating'], ['dryer-wont-start', "Won't start"], ['dryer-not-drying', 'Takes forever to dry'], ['dryer-making-loud-noise', 'Loud noise']],
  washer: [['washer-wont-drain', "Won't drain"], ['washer-not-spinning', "Won't spin"], ['washer-leaking-water', 'Leaking'], ['washer-wont-fill-with-water', "Won't fill"]],
  refrigerator: [['refrigerator-not-cooling', 'Not cooling'], ['refrigerator-leaking-water', 'Leaking water'], ['ice-maker-not-working', 'No ice'], ['refrigerator-making-noise', 'Making noise']],
  dishwasher: [['dishwasher-wont-drain', "Won't drain"], ['dishwasher-not-cleaning', 'Not cleaning'], ['dishwasher-not-drying-dishes', 'Not drying']],
  oven: [['oven-not-heating', 'Not heating'], ['oven-temperature-not-accurate', 'Temp off'], ['oven-wont-turn-off', "Won't turn off"]],
};
// brand landers: the matching brand guide slug per appliance (if the page exists)
const BRAND_SYMPTOM = { refrigerator: 'not-cooling', dryer: 'not-heating', washer: 'not-spinning', dishwasher: 'wont-drain', oven: 'not-heating' };

const exists = (slug) => fs.existsSync(path.join(ROOT, 'fix', slug + '.html'));
const chip = (slug, label) => `<a href="/fix/${slug}.html">${label}</a>`;

// parse "brand-appliance-repair-town" or "appliance-repair-town"
function parse(file) {
  const base = file.replace(/\.html$/, '');
  const idx = base.indexOf('-repair-');
  if (idx < 0) return null;
  const left = base.slice(0, idx).split('-'); // [brand?, appliance] or [appliance]
  const appliance = left[left.length - 1];
  const brand = left.length >= 2 ? left.slice(0, -1).join('-') : null;
  if (!UNIVERSAL[appliance]) return null;
  return { brand, appliance };
}

function block(brand, appliance) {
  const chips = [];
  // brand-specific guide first (highest relevance) when a brand lander + page exists
  if (brand) {
    const bslug = `${brand}-${appliance}-${BRAND_SYMPTOM[appliance]}`;
    if (exists(bslug)) {
      const bLabel = brand.charAt(0).toUpperCase() + brand.slice(1);
      chips.push(chip(bslug, `${bLabel} — ${appliance} fix`));
    }
  }
  UNIVERSAL[appliance].forEach(([s, l]) => { if (exists(s) && chips.length < 5) chips.push(chip(s, l)); });
  chips.push(`<a href="/fix/">All fix guides →</a>`);
  chips.push(`<a href="/error-codes.html">Error codes by brand →</a>`);
  return `${MARK}\n<div class="rel"><div class="k">🔧 Fix it yourself — free technician guides</div>${chips.join('')}</div>`;
}

const files = fs.readdirSync(ROOT).filter((f) => /-repair-.+\.html$/.test(f) && !f.startsWith('appliance-repair-cost'));
let changed = 0, skipped = 0, nomatch = 0;
for (const file of files) {
  const p = path.join(ROOT, file);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes(MARK)) { skipped++; continue; }
  const meta = parse(file);
  if (!meta) { nomatch++; continue; }
  const anchor = '<div class="foot"';
  const i = html.indexOf(anchor);
  if (i < 0) { nomatch++; continue; }
  const inject = block(meta.brand, meta.appliance) + '\n';
  html = html.slice(0, i) + inject + html.slice(i);
  if (APPLY) fs.writeFileSync(p, html);
  changed++;
}
console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — landers: ${files.length} | injected: ${changed} | already-had: ${skipped} | skipped(no match): ${nomatch}`);
