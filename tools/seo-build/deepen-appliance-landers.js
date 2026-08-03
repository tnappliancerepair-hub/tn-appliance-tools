#!/usr/bin/env node
// deepen-appliance-landers — the {appliance}-repair-{city}.html landers were near
// duplicates: every city shared the same appliance symptom list, so Google indexed
// one and left the rest "discovered, not indexed." This injects genuinely UNIQUE,
// substantive per-(city, appliance) content — the city's own local context (reused
// from deepen-cities' hand-written data) woven with real appliance depth, plus a
// per-page FAQ with FAQPage schema. Idempotent (sentinel). Core 5 appliances only
// (highest-volume terms); brand variants come after this proves out.
//
//   node deepen-appliance-landers.js [--only=oven-repair-murfreesboro] [--dry]
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../..');
const OPEN = '<!-- DEEPEN-CA-START -->';
const CLOSE = '<!-- DEEPEN-CA-END -->';
const ANCHOR = '<h2>How the $50 Quick Check works</h2>';

// Reuse the hand-written per-city context from deepen-cities.js (single source of
// truth — no drift). Parse just the CITIES array literal; never execute the script.
function loadCities() {
  const src = fs.readFileSync(path.join(__dirname, 'deepen-cities.js'), 'utf8');
  const m = src.match(/const CITIES = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('could not find CITIES in deepen-cities.js');
  // eslint-disable-next-line no-eval
  const arr = eval(m[1]);
  const byId = {};
  for (const c of arr) {
    // deepen-cities mixes symptom slugs (e.g. dryer-not-heating) into the array — skip
    // anything that isn't a real city (no localContext, or a symptom-looking slug).
    if (!c || !c.slug || !c.localContext || /-not-/.test(c.slug)) continue;
    byId[c.slug] = c;
  }
  return byId;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Per-appliance depth. intro(c) weaves the city into real appliance specifics; faqs(c)
// returns 3 genuinely useful, city-personalized Q&A. Written to READ like a tech wrote
// it — not spun boilerplate.
const APPLIANCES = {
  refrigerator: {
    label: 'Refrigerator',
    intro: (c) => `When a fridge quits in ${c.name}, the fear is a dead compressor — but most of the calls we run turn out to be far cheaper. A refrigerator that's warm but the freezer's fine is almost always a frost-blocked evaporator fan or a failed defrost heater, not the sealed system. A fridge that runs constantly is usually dirty condenser coils or a bad door gasket. We see the whole age range across ${c.nearby} — decade-old side-by-sides that are absolutely worth fixing, and first-year smart units still under warranty. The one time replacement genuinely wins is a true sealed-system leak on an older unit; we'll tell you straight which one you have.`,
    faqs: (c) => [
      { q: `My refrigerator stopped cooling but the freezer still works — is it worth repairing in ${c.name}?`, a: `Almost always yes. That specific symptom points to airflow between the freezer and fridge — a frosted-over evaporator fan or a defrost failure — which is a modest repair, not a compressor. We diagnose it from a short video and a photo of the model sticker before anyone rolls a truck.` },
      { q: `How fast can you get a tech to ${c.name}?`, a: `We schedule by day, not a vague window, and cover ${c.name} and nearby ${c.nearby}. Do the $50 Quick Check first and you often have an honest answer — and the right part already on order — before the visit, which saves a second trip.` },
      { q: `Do you charge a trip fee for a refrigerator diagnosis?`, a: `No surprise $125 trip charge. The $50 Quick Check gets you a real tech's assessment from a video, and it's credited straight to your repair if you move forward.` },
    ],
  },
  washer: {
    label: 'Washer',
    intro: (c) => `Washer calls in ${c.name} cluster around a few honest fixes. Won't drain or won't spin is usually a clogged pump, a broken lid switch, or a worn belt — not the transmission. Bangs and walks across the floor on spin is typically worn suspension rods or shocks. Leaks trace to the door boot, a hose, or the pump seal far more often than anything internal. Front-loaders across ${c.region} take heavy family loads, and most of what fails is wear, which is exactly the stuff worth repairing instead of replacing a machine that has years left in it.`,
    faqs: (c) => [
      { q: `My washer won't spin or drain — what's the likely fix in ${c.name}?`, a: `Nine times out of ten it's the drain pump (often something caught in it), the lid or door lock switch, or a worn belt — all straightforward, affordable repairs. Send a 10-second video of what it's doing and we'll tell you the likely part before we come out.` },
      { q: `The washer shakes hard and moves during spin — is that repairable?`, a: `Yes. That's worn suspension rods or shock absorbers, a common wear item, not a reason to replace the machine. It's a routine fix for our techs serving ${c.name} and ${c.nearby}.` },
      { q: `Is it worth fixing an older washer or should I replace it?`, a: `Most of the time, fix it — a pump, belt, or switch is a small fraction of a new washer's cost. We only steer you to replacement when the tub bearing or transmission on a low-end unit makes the repair uneconomical, and we say so honestly.` },
    ],
  },
  dryer: {
    label: 'Dryer',
    intro: (c) => `A dryer that runs but won't heat is the most common call we get in ${c.name}, and on an electric dryer it's usually a blown heating element or thermal fuse — an affordable, same-idea fix every time. Won't start is typically the door switch, thermal fuse, or start switch. And if it's taking two cycles to dry, the real culprit is very often a clogged vent, not the dryer at all — which is also the #1 dryer-fire cause, so we check it. Gas dryers add an igniter/valve path we handle safely. These machines work hard across ${c.nearby}, and nearly every failure is a wear part worth replacing.`,
    faqs: (c) => [
      { q: `My dryer runs but doesn't heat — what does that cost to fix in ${c.name}?`, a: `On an electric dryer that's almost always a heating element or a thermal fuse — a modest, common repair, not a new dryer. We confirm the exact part from your model number before the visit so we bring it with us.` },
      { q: `My clothes take forever to dry — is the dryer bad?`, a: `Usually not. Long dry times are most often a clogged vent line, which chokes airflow (and is a fire risk). We check the vent as part of the job in ${c.name} — sometimes the "broken dryer" just needed the vent cleared.` },
      { q: `Do you work on gas dryers around ${c.name}?`, a: `Yes — gas and electric, across ${c.name} and ${c.nearby}. Gas igniter and valve work is a call-a-pro job and our licensed techs handle it safely.` },
    ],
  },
  oven: {
    label: 'Oven',
    intro: (c) => `Oven and range calls in ${c.name} are some of the most repair-worthy jobs there are. Won't heat or a weak bake is a failed bake element on electric or a worn igniter on gas — the single most common oven repair, and a small fraction of a new range. Bakes but won't broil is just the other element. Won't hold temperature or burning food is a bad temperature sensor. Gas burners that won't light are usually clogged igniters. Whether it's an older serviceable range in an established ${c.name} home or a newer package out toward ${c.nearby}, replacement really only makes sense when the cabinet or oven liner itself is compromised.`,
    faqs: (c) => [
      { q: `My oven won't heat or bakes unevenly — is it worth fixing in ${c.name}?`, a: `Yes — that's a bake element (electric) or igniter (gas), which is a fraction of a new range's price. It's the most common oven repair we do and a quick one once we have the model number.` },
      { q: `Do you repair gas ranges in ${c.name}?`, a: `We do — across ${c.name} and ${c.nearby}. Gas connections and the 240-volt circuit on electric ranges are exactly the kind of safety work you want a licensed tech for, and that's us.` },
      { q: `The oven display shows an F-code — what does that mean?`, a: `An F-code usually points right at the cause — a sensor, a control fault, or a tripped safety. Send us a photo of the code and your model sticker with the $50 Quick Check and we'll tell you what it is before we come out.` },
    ],
  },
  dishwasher: {
    label: 'Dishwasher',
    intro: (c) => `Dishwasher calls in ${c.name} usually come down to won't drain, won't clean, or leaks. Won't drain is typically a clogged pump or a blocked drain hose — an easy, affordable fix. Dishes coming out dirty is often a failed circulation pump, a clogged spray arm, or a worn wash-motor seal. Leaks trace to the door gasket, a hose, or the pump seal. Across ${c.region}, most dishwashers that "died" just need one of these parts — replacing a built-in is a real expense, so the repair-vs-replace call matters, and we'll give it to you straight.`,
    faqs: (c) => [
      { q: `My dishwasher won't drain — can you fix that in ${c.name}?`, a: `Yes, and it's usually a quick one — a clogged drain pump or a kinked/blocked drain hose. Send a short video and we'll often know the fix before the visit. We cover ${c.name} and nearby ${c.nearby}.` },
      { q: `Dishes come out dirty even on a full cycle — what's wrong?`, a: `Most often it's the circulation pump, a clogged spray arm, or a worn wash seal — not a dead dishwasher. We diagnose it honestly and only recommend replacement when a built-in repair genuinely doesn't pencil out.` },
      { q: `Is it cheaper to repair or replace a built-in dishwasher?`, a: `Usually repair — a pump or valve is far less than a new unit plus the install. Built-in replacement is a real expense in ${c.name} homes, which is why we always quote both honestly.` },
    ],
  },
};

function buildBlock(app, c) {
  const a = APPLIANCES[app];
  const st = c.state || 'TN';
  const faqs = a.faqs(c);
  const faqHtml = faqs.map((f) =>
    `<div style="margin:0 0 12px"><p style="color:#f0f0f0;font-weight:700;font-size:14.5px;margin:0 0 4px">${esc(f.q)}</p>`
    + `<p style="color:var(--gray);font-size:13.5px;margin:0;line-height:1.5">${esc(f.a)}</p></div>`).join('');
  const faqLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  return `${OPEN}
<h2>${a.label} repair in ${esc(c.name)}, ${esc(st)} — what our techs actually see</h2>
<p style="color:var(--gray);font-size:14px;line-height:1.55;margin-bottom:12px">${esc(c.localContext)}</p>
<p style="color:var(--gray);font-size:14px;line-height:1.55;margin-bottom:14px">${esc(a.intro(c))}</p>
<h2>${esc(c.name)} ${a.label.toLowerCase()} repair — quick answers</h2>
<div class="faq">${faqHtml}</div>
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
${CLOSE}
`;
}

function deepenFile(fname, app, city, cities, dry) {
  const c = cities[city];
  if (!c) return 'no-city-data';
  const fp = path.join(REPO, fname);
  if (!fs.existsSync(fp)) return 'missing';
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes(OPEN)) { // idempotent — strip old block, rewrite fresh
    html = html.replace(new RegExp(OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'g'), '');
  }
  const idx = html.indexOf(ANCHOR);
  if (idx === -1) return 'no-anchor';
  const block = buildBlock(app, c);
  const out = html.slice(0, idx) + block + '\n' + html.slice(idx);
  if (!dry) fs.writeFileSync(fp, out, 'utf8');
  return 'deepened';
}

(function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  const cities = loadCities();
  const apps = Object.keys(APPLIANCES);
  const files = fs.readdirSync(REPO).filter((f) => {
    const m = f.match(/^([a-z]+)-repair-([a-z-]+)\.html$/);
    return m && apps.includes(m[1]) && cities[m[2]];
  });
  const targets = only ? files.filter((f) => f === (only.endsWith('.html') ? only : only + '.html')) : files;
  const counts = {};
  for (const f of targets) {
    const m = f.match(/^([a-z]+)-repair-([a-z-]+)\.html$/);
    const r = deepenFile(f, m[1], m[2], cities, dry);
    counts[r] = (counts[r] || 0) + 1;
    if (only || dry) console.log(`  ${r.padEnd(10)} ${f}`);
  }
  console.log((dry ? '[DRY] ' : '') + 'result:', JSON.stringify(counts), '| cities:', Object.keys(cities).length, '| core appliances:', apps.length);
})();
