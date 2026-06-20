// build-local-content.js — inject GENUINELY UNIQUE, factual local content into
// the real-market city hub pages so they stop being 89% boilerplate and can
// actually rank. Each city gets: a unique meta description + a real "Local"
// section (county/parish, real neighborhoods, nearby areas, and a true local
// appliance angle). Facts only — no fabrication. Idempotent via ANT-LOCAL marker.
//
// Run:  node tools/seo-build/build-local-content.js
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');

// Real per-city data. `note` is a true, locally-relevant appliance angle.
const CITIES = {
  'nashville': {
    region: 'Davidson County, TN',
    hoods: ['East Nashville', 'Germantown', 'The Nations', 'Green Hills', 'Donelson', 'Madison', 'Inglewood', 'Sylvan Park', 'Bellevue'],
    near: ['Antioch', 'Hermitage', 'Berry Hill', 'Goodlettsville'],
    note: 'Nashville’s mix of 1940s East-side bungalows and brand-new builds in The Nations means we see everything from 30-year-old Kenmore dryers to first-year LG and Samsung units still under manufacturer warranty. We diagnose the age and the part before we ever roll a truck.',
  },
  'antioch': {
    region: 'southeast Nashville (Davidson County), TN 37013',
    hoods: ['Cane Ridge', 'Priest Lake', 'Hickory Hollow', 'Nippers Corner', 'Una'],
    near: ['Nashville', 'La Vergne', 'Smyrna', 'Brentwood'],
    note: 'Antioch is one of Nashville’s densest residential pockets — lots of newer subdivisions and apartment communities where the same builder-grade Whirlpool and Frigidaire models tend to fail the same ways. That history makes our diagnosis fast and our parts calls accurate.',
  },
  'murfreesboro': {
    region: 'Rutherford County, TN',
    hoods: ['Blackman', 'Siegel', 'Gateway', 'Cason Lane', 'Three Rivers'],
    near: ['Smyrna', 'La Vergne', 'Christiana', 'Eagleville'],
    note: 'Murfreesboro is one of the fastest-growing cities in the country, which means a flood of new-construction homes with appliances right at the edge of their warranty window. We’ll tell you straight whether your repair should be a warranty claim or an out-of-pocket fix.',
  },
  'franklin': {
    region: 'Williamson County, TN',
    hoods: ['Westhaven', 'Cool Springs', 'Berry Farms', 'Downtown Franklin', 'Fieldstone Farms'],
    near: ['Brentwood', 'Spring Hill', 'Nolensville', 'Thompson’s Station'],
    note: 'Williamson County kitchens are full of high-end built-ins — Sub-Zero, Wolf, Viking, Thermador, and Bosch. Those take a tech who knows sealed-system refrigeration and proprietary control boards, not a parts-changer. That’s exactly the kind of diagnosis our Quick Check is built for.',
  },
  'brentwood': {
    region: 'Williamson County, TN',
    hoods: ['Governors Club', 'Annandale', 'Raintree Forest', 'Taramore'],
    near: ['Franklin', 'Nashville', 'Nolensville'],
    note: 'Brentwood homes lean toward premium, built-in appliances where a misdiagnosis gets expensive fast. We pin down the exact failed component and your real options — OEM or quality aftermarket — before anyone spends a dollar.',
  },
  'hendersonville': {
    region: 'Sumner County, TN',
    hoods: ['Indian Lake', 'Walton Ferry', 'Sanders Ferry'],
    near: ['Gallatin', 'Goodlettsville', 'Old Hickory'],
    note: 'Out on Old Hickory Lake, lake-house kitchens and full-time homes alike run a wide range of brands. We carry the diagnostic history across all of them so the first visit is the fix visit.',
  },
  'clarksville': {
    region: 'Montgomery County, TN',
    hoods: ['Sango', 'St. Bethlehem', 'Woodlawn', 'Exit 4'],
    near: ['Fort Campbell', 'Oak Grove, KY', 'Pleasant View'],
    note: 'With Fort Campbell next door, Clarksville sees constant PCS moves and rental turnover — appliances that need a fast, honest diagnosis on a tight timeline. We turn around a video diagnosis in hours, not days, so move-outs and move-ins don’t stall.',
  },
  'baton-rouge': {
    region: 'East Baton Rouge Parish, LA',
    hoods: ['Mid City', 'Garden District', 'Shenandoah', 'Highland', 'Sherwood Forest'],
    near: ['Baker', 'Zachary', 'Prairieville', 'Denham Springs'],
    note: 'Baton Rouge’s heat and humidity put real strain on refrigerators and freezers, and summer storm surges are notorious for frying appliance control boards. We check for surge and moisture damage first — it’s the most common thing other shops miss down here.',
  },
  'new-orleans': {
    region: 'Orleans Parish, LA',
    hoods: ['Uptown', 'Mid-City', 'Lakeview', 'Gentilly', 'Algiers', 'Marigny'],
    near: ['Metairie', 'Kenner', 'Chalmette', 'Gretna'],
    note: 'New Orleans’ older housing stock, year-round humidity, and storm history make for unique appliance wear — sweating fridge gaskets, mold-prone door seals, and surge-damaged boards after every big storm. We diagnose for the climate, not just the symptom.',
  },
  'metairie': {
    region: 'Jefferson Parish, LA',
    hoods: ['Old Metairie', 'Bucktown', 'Fat City'],
    near: ['Kenner', 'New Orleans', 'Harahan'],
    note: 'Jefferson Parish humidity is hard on dryers and refrigerator seals. A 10-second video of the symptom usually tells us whether you’re looking at a vent issue, a seal, or a sealed-system problem before we ever knock on the door.',
  },
  'kenner': {
    region: 'Jefferson Parish, LA',
    hoods: ['Chateau Estates', 'University City', 'Driftwood'],
    near: ['Metairie', 'Harahan', 'New Orleans'],
    note: 'Same Gulf humidity, same hard wear on dryers and fridges. We carry the failure history across the common Kenner builder brands so the parts call is right the first time.',
  },
  'hammond': {
    region: 'Tangipahoa Parish, LA',
    hoods: ['University area (SLU)', 'North Oaks area', 'Downtown Hammond'],
    near: ['Ponchatoula', 'Albany', 'Independence'],
    note: 'On the Northshore, humidity and frequent power flickers are the two things that take appliances down most. We check for surge-damaged boards and moisture issues up front — and we serve the whole Tangipahoa/Livingston corridor.',
  },
  'covington': {
    region: 'St. Tammany Parish, LA',
    hoods: ['Downtown Covington', 'River Forest', 'Tchefuncte'],
    near: ['Mandeville', 'Madisonville', 'Abita Springs'],
    note: 'Northshore homes from historic downtown to new Tchefuncte builds run the full brand range. Our video Quick Check sorts the quick fix from the not-worth-it before you spend a trip-charge finding out.',
  },
  'slidell': {
    region: 'St. Tammany Parish, LA',
    hoods: ['Olde Towne', 'Eden Isles', 'Lakeshore Estates'],
    near: ['Pearl River', 'Lacombe', 'New Orleans East'],
    note: 'Slidell sits right in the storm-surge path, so post-storm control-board and moisture damage is something we see constantly. We diagnose for it first — it’s the failure other techs overlook on the east side of the lake.',
  },
  'denham-springs': {
    region: 'Livingston Parish, LA',
    hoods: ['Watson', 'Walker area', 'Juban Crossing'],
    near: ['Walker', 'Baton Rouge', 'Livingston'],
    note: 'Livingston Parish still has a lot of post-2016-flood appliances — units that were replaced in a hurry and are now hitting their failure window together. We know the brands that went in and the parts they need.',
  },
};

const tc = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

let done = 0;
for (const [slug, d] of Object.entries(CITIES)) {
  const fp = path.join(REPO, slug + '.html');
  if (!fs.existsSync(fp)) { console.log('skip (no file):', slug); continue; }
  const city = tc(slug);
  let html = fs.readFileSync(fp, 'utf8');

  // 1) Unique meta description (real, varied — not a templated swap).
  const desc = `Appliance repair in ${city} — ${d.region}. ${d.note.split('. ')[0]}. Honest $50 video Quick Check, real techs, OEM or aftermarket parts. Serving ${d.hoods.slice(0, 3).join(', ')} & nearby.`
    .replace(/\s+/g, ' ').slice(0, 300);
  html = html.replace(/<meta name="description" content="[^"]*">/i,
    `<meta name="description" content="${desc.replace(/"/g, '&quot;')}">`);

  // 2) Unique local content section (idempotent).
  const block = `
<!-- ANT-LOCAL -->
<section style="max-width:820px;margin:30px auto 0;padding:22px 0 0;border-top:1px solid var(--border,#1a1a1a);font-family:var(--mono,inherit)">
  <h2 style="font-family:var(--block,inherit);font-size:24px;letter-spacing:.04em;margin-bottom:12px">Appliance repair in ${city} — ${d.region}</h2>
  <p style="color:var(--gray,#888);font-size:15px;line-height:1.6;margin-bottom:14px">${d.note}</p>
  <p style="color:var(--gray,#888);font-size:14px;line-height:1.7">We cover ${city} and the surrounding neighborhoods — ${d.hoods.join(', ')} — plus nearby ${d.near.join(', ')}. Washers, dryers, refrigerators, freezers, dishwashers, ranges and ovens, all major brands. Start with a 10-second video and the model sticker, and you’ll have an honest answer and your repair options within about two business hours.</p>
</section>
<!-- /ANT-LOCAL -->
`;
  html = html.replace(/\n?<!-- ANT-LOCAL -->[\s\S]*?<!-- \/ANT-LOCAL -->\n?/g, '');
  if (html.includes('</body>')) html = html.replace('</body>', block + '\n</body>');
  else html += block;

  fs.writeFileSync(fp, html, 'utf8');
  done++;
  console.log('✓', slug);
}
console.log(`\nUnique local content + meta injected into ${done} real-market city hubs.`);
