// build-local-faq.js — add genuinely city-specific FAQs + FAQPage schema to the
// real-market city hubs. The visible Q&A deepens the unique content; the schema
// makes the page eligible for FAQ rich snippets (extra space in Google results).
// Real answers built from city-data.js facts. Idempotent via ANT-LOCAL-FAQ.
//
// Run:  node tools/seo-build/build-local-faq.js
'use strict';
const fs = require('fs');
const path = require('path');
const CITIES = require('./city-data.js');
const REPO = path.join(__dirname, '..', '..');
const tc = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function faqsFor(city, d) {
  const brands = d.brands || 'all major brands — Whirlpool, GE, Samsung, LG, Frigidaire, Maytag, KitchenAid, Bosch and more';
  return [
    {
      q: `How fast can you help with appliance repair in ${city}?`,
      a: `Most ${city} customers get an honest diagnosis within about two business hours of sending a 10-second video and a photo of the model sticker — no sitting around for an all-day service window.`,
    },
    {
      q: `Which ${city} areas do you serve?`,
      a: `We cover ${city} (${d.region}) and the surrounding neighborhoods including ${d.hoods.slice(0, 5).join(', ')}, plus nearby ${d.near.join(', ')}.`,
    },
    {
      q: `What appliance problems are most common in ${city}?`,
      a: `In ${city} we most often see ${d.commonIssue}. Because we track that history locally, our diagnosis is fast and our parts call is accurate the first time.`,
    },
    {
      q: `What brands do you repair in ${city}?`,
      a: `We service ${brands}, across washers, dryers, refrigerators, freezers, dishwashers, ranges and ovens.`,
    },
  ];
}

let done = 0;
for (const [slug, d] of Object.entries(CITIES)) {
  const fp = path.join(REPO, slug + '.html');
  if (!fs.existsSync(fp)) { console.log('skip (no file):', slug); continue; }
  const city = tc(slug);
  const faqs = faqsFor(city, d);
  let html = fs.readFileSync(fp, 'utf8');

  const rows = faqs.map((f) => `  <details style="border:1px solid var(--border,#1a1a1a);border-radius:11px;padding:14px 16px;margin-bottom:10px">
    <summary style="cursor:pointer;font-weight:600;color:var(--white,#f0f0f0);font-size:15px">${esc(f.q)}</summary>
    <p style="color:var(--gray,#888);font-size:14px;line-height:1.6;margin-top:10px">${esc(f.a)}</p>
  </details>`).join('\n');

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const block = `
<!-- ANT-LOCAL-FAQ -->
<section style="max-width:820px;margin:26px auto 0;padding:18px 0 0;font-family:var(--mono,inherit)">
  <h2 style="font-family:var(--block,inherit);font-size:24px;letter-spacing:.04em;margin-bottom:14px">${city} appliance repair — FAQ</h2>
${rows}
</section>
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<!-- /ANT-LOCAL-FAQ -->
`;
  html = html.replace(/\n?<!-- ANT-LOCAL-FAQ -->[\s\S]*?<!-- \/ANT-LOCAL-FAQ -->\n?/g, '');
  if (html.includes('</body>')) html = html.replace('</body>', block + '\n</body>');
  else html += block;

  fs.writeFileSync(fp, html, 'utf8');
  done++;
  console.log('✓', slug);
}
console.log(`\nCity-specific FAQ + FAQPage schema injected into ${done} hubs.`);
