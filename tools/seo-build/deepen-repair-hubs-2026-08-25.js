#!/usr/bin/env node
/* deepen-repair-hubs-2026-08-25 — FAQ depth for the two flagship hubs the SEO scorecard
 * flagged today (2026-08-25): "dryer repair" #21 / 183 impr / 0 clicks, "dishwasher
 * repair" #23 / 138 impr / 0 clicks.
 *
 * The hubs are already content-rich and (as of 2026-08-20) internally linked to their
 * city landers. What they were still thin on: FAQ coverage — only 5 Q&A each, which
 * under-captures the "People Also Ask" long-tail and leaves rich-result surface on the
 * table. This adds 6 high-intent, honest Q&A to EACH hub, kept in sync across BOTH the
 * visible <div class="faq"> block AND the FAQPage schema mainEntity (Google requires the
 * two to match), with inline links into the existing symptom cluster. Then bumps the two
 * pages' sitemap <lastmod> for a freshness signal.
 *
 * Idempotent — skips a hub if the <!--FAQ25--> marker is already present. No new pricing
 * claims beyond what the hubs already state; symptom links point only at pages confirmed
 * to exist.
 *   Run: node tools/seo-build/deepen-repair-hubs-2026-08-25.js   (DRY_RUN=1 to preview)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const DRY = process.env.DRY_RUN === '1';
const DATE = '2026-08-25';

// New Q&A per hub. `a` = plain-text answer (used verbatim in the FAQPage schema).
// `link` (optional) = { href, text } appended ONLY to the visible answer as a follow-on.
const FAQ = {
  dryer: [
    { q: 'Why is my dryer running but not heating?',
      a: 'On an electric dryer the usual causes are a burned-out heating element, a blown thermal fuse, or a failed thermostat; on a gas dryer it is most often the igniter or flame sensor. Check that both household breakers are on and the vent is not clogged, then let a technician confirm the exact part before anything is ordered.',
      link: { href: '/fix/dryer-not-heating', text: 'See our dryer-not-heating guide' } },
    { q: 'Why does my dryer take two or three cycles to dry a load?',
      a: 'Nine times out of ten it is airflow, not the dryer — a clogged lint screen or a blocked exhaust vent line traps the moist air so clothes never fully dry. That same lint buildup is the number-one cause of dryer fires, so it is worth clearing. If airflow is clear, a weak heating element or thermostat is the next suspect.',
      link: { href: '/dryer-takes-too-long', text: 'See our dryer-takes-too-long guide' } },
    { q: 'Is it safe to keep using a dryer that smells like burning?',
      a: 'No — stop using it. A burning smell usually means lint has built up near the heating element or in the vent, which is a real fire risk, and it can also be a failing motor or bearing. Unplug it (or shut off the gas) and have it looked at before you run another load.',
      link: { href: '/fix/dryer-smells-like-burning', text: 'See our burning-smell guide' } },
    { q: 'Do you repair gas dryers?',
      a: 'Yes — we service both electric and gas dryers. Gas work (igniters, valve coils, flame sensors) is handled safely by our technicians; we never leave a gas connection you have to second-guess.' },
    { q: 'How long does a dryer repair take?',
      a: 'Most dryer repairs are a single visit. Because your video and model number let us pre-diagnose and bring the right part, the actual repair usually takes 30 to 60 minutes once we are at your door.' },
    { q: 'Do you offer same-day dryer repair near me?',
      a: 'We offer same-day and next-day dryer repair across Middle Tennessee and Louisiana. Tell us what your dryer is doing and send a short video, and we text you right back to book the first open slot in your area.' },
  ],
  dishwasher: [
    { q: 'Why is my dishwasher leaking onto the floor?',
      a: 'The common culprits are a worn or torn door gasket, a failing pump or sump seal, a loose hose clamp, or over-sudsing from the wrong detergent. Because a slow leak can damage cabinets and flooring, it is worth pinning down the exact source quickly rather than guessing.',
      link: { href: '/fix/dishwasher-leaking-onto-floor', text: 'See our dishwasher-leak guide' } },
    { q: 'Why won\u2019t my dishwasher start?',
      a: 'Start with the basics — a door that is not latching, a tripped outlet or breaker, or a stuck child-lock. If power is good and the door latches, the likely causes are the door latch switch, the control board, or a blown thermal fuse. A technician confirms which before any part is ordered.',
      link: { href: '/fix/dishwasher-wont-start', text: 'See our dishwasher-won\u2019t-start guide' } },
    { q: 'Why does my dishwasher leave a white film or spots on dishes?',
      a: 'Usually hard water plus an empty rinse-aid dispenser, or the wrong detergent for your water. Refill rinse aid and try a dishwasher cleaner first; if the film persists it can point to a water-heating or fill problem the dishwasher itself needs looked at.',
      link: { href: '/fix/dishwasher-leaving-white-film', text: 'See our white-film guide' } },
    { q: 'Why does my dishwasher smell bad?',
      a: 'Trapped food and grease in the filter, sump, or drain hose grow a biofilm that smells. Pull and rinse the filter, wipe the sump, and run an empty hot cycle with a dishwasher cleaner. If the odor comes back fast, the drain hose routing or a partial clog is usually behind it.',
      link: { href: '/fix/dishwasher-smells-bad', text: 'See our dishwasher-odor guide' } },
    { q: 'How long does a dishwasher repair take?',
      a: 'Most dishwasher repairs are a single visit. Pre-diagnosing from your video and model number means we arrive with the right part, and the repair itself typically runs 45 to 90 minutes.' },
    { q: 'Do you offer same-day dishwasher repair near me?',
      a: 'We offer same-day and next-day dishwasher repair across Middle Tennessee and Louisiana. Send a short video of what it is doing and we text you right back to book the first open slot in your area.' },
  ],
};

const VIS_ANCHOR = 'Amana, and more.</div></div></div>';           // closes .faq-a, .faq-item, .faq
const SCH_ANCHOR = 'Amana, and more."}}]}';                         // closes FAQPage mainEntity

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function visItem(item) {
  const linkHtml = item.link ? ` <a href="${item.link.href}">${esc(item.link.text)} &rarr;</a>` : '';
  return `<div class="faq-item"><div class="faq-q">${esc(item.q)}</div><div class="faq-a">${esc(item.a)}${linkHtml}</div></div>`;
}
function schItem(item) {
  return `{"@type":"Question","name":${JSON.stringify(item.q)},"acceptedAnswer":{"@type":"Answer","text":${JSON.stringify(item.a)}}}`;
}

let touched = 0;
function deepen(appliance) {
  const file = `${appliance}-repair.html`;
  const fp = path.join(ROOT, file);
  if (!fs.existsSync(fp)) { console.log(`  skip ${file} — not found`); return; }
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes('<!--FAQ25-->')) { console.log(`  ${file}: FAQ25 already present — skip`); return; }
  if (!html.includes(VIS_ANCHOR) || !html.includes(SCH_ANCHOR)) {
    console.log(`  ${file}: FAQ anchor not found — skip (vis:${html.includes(VIS_ANCHOR)} sch:${html.includes(SCH_ANCHOR)})`);
    return;
  }
  const items = FAQ[appliance];
  const visNew = '<!--FAQ25-->' + items.map(visItem).join('');
  const schNew = ',' + items.map(schItem).join(',');

  // visible: insert new items between the last .faq-item close and the .faq close
  html = html.replace(VIS_ANCHOR, 'Amana, and more.</div></div>' + visNew + '</div>');
  // schema: insert new Question objects before the mainEntity array close
  html = html.replace(SCH_ANCHOR, 'Amana, and more."}}' + schNew + ']}');

  if (!DRY) fs.writeFileSync(fp, html);
  console.log(`  ${file}: +${items.length} FAQ (visible + schema in sync)`);
  touched++;
}

function bumpSitemap() {
  const fp = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(fp)) { console.log('  sitemap.xml not found — skip'); return; }
  let xml = fs.readFileSync(fp, 'utf8');
  const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let n = 0;
  for (const p of ['dryer-repair', 'dishwasher-repair']) {
    const loc = `<loc>https://tnapplianceexchange.net/${p}</loc>`;
    if (!xml.includes(loc)) { console.log(`  sitemap: no <loc> for /${p}`); continue; }
    if (new RegExp(rx(loc) + '\\s*<lastmod>').test(xml)) {
      xml = xml.replace(new RegExp('(' + rx(loc) + '\\s*<lastmod>)[^<]*(</lastmod>)'), `$1${DATE}$2`);
    } else {
      xml = xml.replace(loc, `${loc}\n    <lastmod>${DATE}</lastmod>`);
    }
    n++;
  }
  if (!DRY && n) fs.writeFileSync(fp, xml);
  console.log(`  sitemap: bumped ${n}/2 lastmod -> ${DATE}`);
}

console.log(DRY ? 'DRY RUN — no writes\n' : 'Deepening repair hubs\n');
deepen('dryer');
deepen('dishwasher');
bumpSitemap();
console.log(`\nDone. Pages touched: ${touched}`);
