// build-brand-symptom-pages.js — the Ant knowledge base, brand layer. For each
// (brand, symptom) it fuses the deep universal symptom guide (troubleshooting-
// content.js) with the brand-specific knowledge (brand-symptom-knowledge.js) into
// one substantive page: brand lede + brand causes + real fault codes + the known
// design issue + brand reset/force-mode + the universal guide + merged FAQ + schema.
//
// Targets the proven high-volume queries ("samsung refrigerator not cooling" ~6,600/mo,
// "lg refrigerator not cooling" ~5,400/mo, etc.). NOT thin doorways — each page says
// what's genuinely different about that brand.
//
// Path: /fix/<brand>-<symptom>.html   (e.g. /fix/samsung-refrigerator-not-cooling.html)
// Run:  node scripts/build-brand-symptom-pages.js
'use strict';
const fs = require('fs');
const path = require('path');
const BASE_ITEMS = require('./troubleshooting-content');
const KB = require('./brand-symptom-knowledge');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'fix');
const BASE = 'https://tnapplianceexchange.net';
const PHONE = '1-888-268-8998';
const TEL = '+18882688998';
const QC = '/quick-check-intake.html';
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

const APPLIANCE_OF = { 'refrigerator-not-cooling': 'refrigerator', 'dryer-not-heating': 'dryer', 'washer-wont-drain': 'washer', 'dishwasher-wont-drain': 'dishwasher', 'washer-not-spinning': 'washer', 'oven-not-heating': 'oven', 'dishwasher-not-cleaning': 'dishwasher', 'refrigerator-making-noise': 'refrigerator' };
const SYMPTOM_PHRASE = { 'refrigerator-not-cooling': 'not cooling', 'dryer-not-heating': "not heating", 'washer-wont-drain': "won't drain", 'dishwasher-wont-drain': "won't drain", 'washer-not-spinning': "won't spin", 'oven-not-heating': 'not heating', 'dishwasher-not-cleaning': 'not cleaning', 'refrigerator-making-noise': 'making noise' };

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0b0b0c;--surf:#141416;--bord:#26262a;--ink:#ececec;--dim:#a0a0a6;--orange:#ff6200;--green:#39ff14}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.65;padding:0 18px 72px}
.wrap{max-width:720px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid var(--bord);position:sticky;top:0;background:var(--bg);z-index:5}
.brand{font-weight:800;letter-spacing:.02em;color:var(--ink);text-decoration:none;font-size:18px}
.brand b{color:var(--orange)}
.callbtn{font-size:13px;color:var(--ink);text-decoration:none;border:1px solid var(--bord);border-radius:8px;padding:8px 12px;white-space:nowrap}
nav.bc{font-size:12.5px;color:var(--dim);padding:16px 0 4px}
nav.bc a{color:var(--dim);text-decoration:none}
nav.bc a:hover{color:var(--orange)}
h1{font-size:clamp(25px,5.5vw,36px);line-height:1.15;margin:14px 0 6px;text-wrap:balance}
h1 .a{color:var(--green)}
.lede{color:var(--dim);font-size:17px;margin:10px 0 20px}
h2{font-size:22px;margin:34px 0 6px;padding-top:8px}
h3{font-size:17px}
p{margin:12px 0}
.safety{background:rgba(255,98,0,.08);border:1px solid rgba(255,98,0,.35);border-radius:10px;padding:12px 14px;font-size:14.5px;margin:18px 0}
.safety b{color:var(--orange)}
.known{background:rgba(57,255,20,.06);border:1px solid rgba(57,255,20,.3);border-radius:10px;padding:12px 14px;font-size:14.5px;margin:18px 0}
.known b{color:var(--green)}
.reset{background:var(--surf);border:1px dashed var(--bord);border-radius:10px;padding:12px 14px;font-size:14.5px;margin:16px 0}
.reset b{color:var(--orange)}
.cause{background:var(--surf);border:1px solid var(--bord);border-radius:12px;padding:16px 18px;margin:14px 0}
.cause h3{margin:0 0 4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tag{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid var(--bord);color:var(--dim)}
.tag.Easy{color:#39ff14;border-color:rgba(57,255,20,.4)}
.tag.Moderate{color:#ffd166;border-color:rgba(255,209,102,.4)}
.tag.Pro{color:#ff6b6b;border-color:rgba(255,107,107,.4)}
.cause .why{color:var(--dim);font-size:15px;margin:6px 0}
.cause .diy{font-size:14.5px;margin:6px 0 0}
.cause .diy b{color:var(--orange)}
table.codes{width:100%;border-collapse:collapse;margin:12px 0;font-size:14.5px}
table.codes td{border-bottom:1px solid var(--bord);padding:9px 8px;vertical-align:top}
table.codes td.c{color:var(--orange);font-weight:700;white-space:nowrap;width:96px}
.cta{background:linear-gradient(180deg,#161616,#0f0f0f);border:1px solid var(--bord);border-radius:16px;padding:22px;margin:30px 0}
.cta h2{margin:0 0 6px;padding:0}
.cta p{font-size:15px;color:var(--dim);margin:6px 0 16px}
.btnrow{display:flex;gap:12px;flex-wrap:wrap}
.btn{flex:1 1 220px;text-align:center;text-decoration:none;font-weight:700;border-radius:12px;padding:15px 18px;font-size:15.5px}
.btn.p{background:var(--orange);color:#0b0b0c}
.btn.s{background:transparent;color:var(--ink);border:1px solid var(--bord)}
details{border-bottom:1px solid var(--bord);padding:4px 0}
summary{cursor:pointer;font-weight:600;font-size:16px;padding:14px 0;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";float:right;color:var(--orange);font-weight:700}
details[open] summary::after{content:"–"}
details p{color:var(--dim);font-size:15px;padding:0 0 14px}
.near{display:flex;flex-wrap:wrap;gap:9px;margin:14px 0}
.near a{font-size:13.5px;color:var(--ink);text-decoration:none;background:var(--surf);border:1px solid var(--bord);border-radius:999px;padding:8px 13px}
.near a:hover{border-color:var(--orange)}
footer{border-top:1px solid var(--bord);margin-top:44px;padding:22px 0;color:var(--dim);font-size:13px}
footer a{color:var(--dim)}`;

function ctaBlock(brand, appliance) {
  return `    <div class="cta">
      <h2>Get the exact ${esc(brand)} part — shipped to your door</h2>
      <p>With the <b>$50 Quick Check</b>, send a short video and a photo of your ${esc(brand)} ${esc(appliance)}'s model number. A real technician confirms the diagnosis and we ship you the exact part with instructions — the $50 is credited toward it. Or we walk you through the fix free.</p>
      <div class="btnrow">
        <a class="btn p" href="${QC}">Start your $50 Quick Check →</a>
        <a class="btn s" href="tel:${TEL}">Call or text us · ${PHONE}</a>
      </div>
    </div>`;
}

function page(symptomSlug, brand, data, base, siblings) {
  const appliance = APPLIANCE_OF[symptomSlug];
  const phrase = SYMPTOM_PHRASE[symptomSlug];
  const slug = `${slugify(brand)}-${symptomSlug}`;
  const url = `${BASE}/fix/${slug}.html`;
  const tc = (s) => s.replace(/\b\w/g, (m) => m.toUpperCase());
  const applCap = appliance.charAt(0).toUpperCase() + appliance.slice(1);
  const phraseCap = tc(phrase);
  const h1 = `${brand} ${applCap} ${phraseCap}?`;
  const hasCodes = !!(data.faultCodes && data.faultCodes.length);
  const title = `${brand} ${applCap} ${phraseCap} — Causes${hasCodes ? ', Fault Codes' : ''} & Fixes`;
  const metaDesc = `${brand} ${appliance} ${phrase}? A real technician explains the exact ${brand} causes, fault codes, and safe fixes — and the known ${brand} issue to check first. Free guide + get the part shipped. ${PHONE}.`;

  const brandCauses = (data.causes || []).map((c) => `      <div class="cause"><h3>${esc(c.name)} ${c.difficulty ? `<span class="tag ${c.difficulty}">${c.difficulty}</span>` : ''}</h3><div class="why">${esc(c.why)}</div>${c.diy ? `<div class="diy"><b>What you can check:</b> ${esc(c.diy)}</div>` : ''}</div>`).join('\n');
  const codeRows = (data.faultCodes || []).map((f) => `      <tr><td class="c">${esc(f.code)}</td><td>${esc(f.meaning)}</td></tr>`).join('\n');
  const codesBlock = (data.faultCodes && data.faultCodes.length) ? `    <h2>${esc(brand)} ${esc(appliance)} fault codes</h2>\n    <table class="codes">\n${codeRows}\n    </table>` : '';

  // universal base guide (condensed)
  const baseCauses = base ? (base.causes || []).slice(0, 6).map((c) => `      <div class="cause"><h3>${esc(c.name)} ${c.difficulty ? `<span class="tag ${c.difficulty}">${c.difficulty}</span>` : ''}</h3><div class="why">${esc(c.why)}</div>${c.diy ? `<div class="diy"><b>What you can check:</b> ${esc(c.diy)}</div>` : ''}</div>`).join('\n') : '';

  // merged FAQ: a brand-specific Q first, then base FAQs
  const faqs = [];
  faqs.push({ q: `Why is my ${brand} ${appliance} ${phrase}?`, a: data.lede });
  if (data.knownIssue) faqs.push({ q: `Is there a known issue with ${brand} ${appliance}s ${phrase}?`, a: data.knownIssue });
  for (const f of (base ? base.faqs || [] : [])) faqs.push(f);
  const faqHtml = faqs.map((f) => `      <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n');
  const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: BASE + '/' },
    { '@type': 'ListItem', position: 2, name: 'Repair Guides', item: BASE + '/fix/' },
    { '@type': 'ListItem', position: 3, name: title, item: url } ] };

  const near = siblings.filter((s) => s.slug !== slug).slice(0, 8).map((s) => `<a href="/fix/${s.slug}.html">${esc(s.brand)} ${esc(s.appliance)}</a>`).join('\n        ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | TN Appliance Exchange</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(h1)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
<script type="application/ld+json">${JSON.stringify(bc)}</script>
<style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:${TEL}">Call or text · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/">Home</a> › <a href="/fix/">Repair Guides</a> › ${esc(brand)} ${esc(appliance)}</nav>
    <h1>${esc(h1)}</h1>
    <div class="lede">${esc(data.lede)}</div>

    <div class="known"><b>The known ${esc(brand)} issue:</b> ${esc(data.knownIssue)}</div>

    <h2>What's actually different about a ${esc(brand)}</h2>
${brandCauses}

${codesBlock}

${data.forceReset ? `    <div class="reset"><b>Try this first:</b> ${esc(data.forceReset)}</div>` : ''}

${ctaBlock(brand, appliance)}

${base ? `    <h2>How this failure works on any ${esc(appliance)}</h2>\n    <p>${esc(base.intro)}</p>\n${base.safety ? `    <div class="safety"><b>Safety first:</b> ${esc(base.safety)}</div>` : ''}\n${baseCauses}\n${base.repairReplace ? `    <h2>Is it worth repairing?</h2>\n    <p>${esc(base.repairReplace)}</p>` : ''}` : ''}

    <h2>Frequently asked questions</h2>
${faqHtml}

    <h2>Other ${esc(brand)} & brand guides</h2>
    <div class="near">
        ${near}
        <a href="/fix/${symptomSlug}.html">All ${esc(appliance)}s ${esc(phrase)}</a>
    </div>

    <footer>
      <p><b>TN Appliance Exchange</b> — honest, technician-led appliance repair since 2012. We diagnose ${esc(brand)} ${esc(appliance)}s by video and ship the exact part anywhere in the U.S. Call or text ${PHONE}. <span style="opacity:.7">Se habla español.</span></p>
      <p style="margin-top:8px"><a href="/fix/">All repair guides</a> · <a href="/repair/">Repair near you</a> · <a href="/">Home</a></p>
    </footer>
  </div>
</body>
</html>`;
}

// ---- build the sibling index (for cross-linking) ----
const all = [];
for (const symptomSlug of Object.keys(KB)) {
  for (const brand of Object.keys(KB[symptomSlug])) {
    all.push({ slug: `${slugify(brand)}-${symptomSlug}`, brand, appliance: APPLIANCE_OF[symptomSlug], symptomSlug });
  }
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const urls = [];
for (const symptomSlug of Object.keys(KB)) {
  const base = BASE_ITEMS.find((x) => x.slug === symptomSlug) || null;
  const siblings = all.filter((s) => s.appliance === APPLIANCE_OF[symptomSlug]);
  for (const brand of Object.keys(KB[symptomSlug])) {
    const html = page(symptomSlug, brand, KB[symptomSlug][brand], base, siblings);
    const slug = `${slugify(brand)}-${symptomSlug}`;
    fs.writeFileSync(path.join(OUT, `${slug}.html`), html);
    urls.push(`${BASE}/fix/${slug}.html`);
  }
}
console.log('Wrote ' + urls.length + ' brand×symptom knowledge pages to /fix/');
fs.writeFileSync(path.join(__dirname, '.brand-symptom-urls.txt'), urls.join('\n'));
