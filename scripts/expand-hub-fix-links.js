// One-shot: expand the "Common problems we fix" chip row on each service hub to
// link the full relevant /fix/ guide cluster for that appliance. Internal links from
// pages that already rank (the hubs) to the conversion content (/fix/) — boosts both.
// Idempotent: matches the single flex chip-row line containing /fix/ and rebuilds it.
'use strict';
const fs = require('fs');
const CHIP = (slug, label) => `<a href="/fix/${slug}.html" style="color:#ff6200;text-decoration:none;border:1px solid #252525;border-radius:8px;padding:7px 12px;font-size:13px;display:inline-block">${label}</a>`;
const ALL = `<a href="/fix/" style="color:#ff6200;text-decoration:none;border:1px solid #252525;border-radius:8px;padding:7px 12px;font-size:13px;display:inline-block">All repair guides →</a>`;

const SETS = {
  'dryer-repair.html': [
    ['dryer-not-heating', 'Not heating'],
    ['dryer-wont-start', "Won't start"],
    ['dryer-not-drying', 'Takes forever to dry'],
    ['lg-dryer-d80-d90-d95-error-code', 'LG d80/d90/d95 code'],
    ['samsung-dryer-he-error-code', 'Samsung HE code'],
    ['whirlpool-dryer-not-heating', 'Whirlpool not heating'],
    ['samsung-dryer-not-heating', 'Samsung not heating'],
    ['lg-dryer-not-heating', 'LG not heating'],
  ],
  'washer-repair.html': [
    ['washer-wont-drain', "Won't drain"],
    ['washer-not-spinning', "Won't spin"],
    ['washer-leaking-water', 'Leaking water'],
    ['lg-washer-oe-error-code', 'LG OE code'],
    ['lg-washer-ue-error-code', 'LG UE code'],
    ['samsung-washer-4c-error-code', 'Samsung 4C code'],
    ['samsung-washer-5c-error-code', 'Samsung 5C code'],
    ['whirlpool-washer-f21-error-code', 'Whirlpool F21 code'],
    ['samsung-washer-wont-drain', "Samsung won't drain"],
  ],
  'refrigerator-repair.html': [
    ['refrigerator-not-cooling', 'Not cooling'],
    ['refrigerator-freezing-food', 'Freezing food'],
    ['refrigerator-leaking-water', 'Leaking water'],
    ['ice-maker-not-working', 'Ice maker not working'],
    ['refrigerator-water-dispenser-not-working', 'Water dispenser'],
    ['samsung-refrigerator-not-cooling', 'Samsung not cooling'],
    ['lg-refrigerator-not-cooling', 'LG not cooling'],
    ['whirlpool-refrigerator-not-cooling', 'Whirlpool not cooling'],
    ['samsung-ice-maker-not-working', 'Samsung ice maker'],
  ],
  'dishwasher-repair.html': [
    ['dishwasher-wont-drain', "Won't drain"],
    ['dishwasher-not-cleaning', 'Not cleaning'],
    ['dishwasher-wont-start', "Won't start"],
    ['bosch-dishwasher-e15-error-code', 'Bosch E15 code'],
    ['bosch-dishwasher-wont-drain', "Bosch won't drain"],
    ['samsung-dishwasher-wont-drain', "Samsung won't drain"],
    ['lg-dishwasher-wont-drain', "LG won't drain"],
    ['whirlpool-dishwasher-wont-drain', "Whirlpool won't drain"],
  ],
  'oven-repair.html': [
    ['oven-not-heating', 'Oven not heating'],
    ['gas-range-wont-light', "Gas range won't light"],
  ],
};

// The chip row is a single <div style="display:flex;flex-wrap:wrap;gap:8px">…/fix/…</div> line.
const ROW_RE = /<div style="display:flex;flex-wrap:wrap;gap:8px">(?:(?!<\/div>).)*href="\/fix\/(?:(?!<\/div>).)*<\/div>/;

let changed = 0;
for (const [file, chips] of Object.entries(SETS)) {
  if (!fs.existsSync(file)) { console.log('SKIP (missing):', file); continue; }
  const src = fs.readFileSync(file, 'utf8');
  if (!ROW_RE.test(src)) { console.log('SKIP (no chip row found):', file); continue; }
  // sanity: every target file must exist
  for (const [slug] of chips) { if (!fs.existsSync(`fix/${slug}.html`)) { console.log(`  WARN missing target fix/${slug}.html for ${file}`); } }
  const row = `<div style="display:flex;flex-wrap:wrap;gap:8px">` + chips.map(([s, l]) => CHIP(s, l)).join(' ') + ' ' + ALL + '</div>';
  const out = src.replace(ROW_RE, row);
  fs.writeFileSync(file, out);
  console.log(`updated ${file} -> ${chips.length + 1} chips`);
  changed++;
}
console.log('done, files changed:', changed);
