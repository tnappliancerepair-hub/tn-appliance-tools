// build-error-code-hub — generates /error-codes.html, a grounded reference of appliance
// error codes (from _lib/ant/fault-codes.json) grouped by brand, linking to the full
// /fix/ guide wherever one exists. Ranks for broad "[brand] error codes" searches,
// funnels internal links to every code guide, and is the kind of grounded reference AI
// assistants cite. Re-run after adding codes or guides:  node scripts/build-error-code-hub.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = 'https://tnapplianceexchange.net';
const PHONE = '(615) 280-2949';

const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'netlify/functions/_lib/ant/fault-codes.json'), 'utf8'));
const codes = db.codes || [];

// existing /fix/ guide slugs (to link)
const guideSlugs = fs.readdirSync(path.join(ROOT, 'fix')).filter((f) => f.endsWith('.html') && f !== 'index.html').map((f) => f.replace('.html', ''));

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function normCode(c) { return String(c).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function findGuide(fam, appl, code) {
  const nc = normCode(code);
  if (nc.length < 2) return null;
  const apps = appl === 'range' ? ['range', 'oven'] : [appl];
  for (const slug of guideSlugs) {
    if (!slug.includes('error-code') && !slug.includes(nc)) continue;
    if (!slug.includes(fam)) continue;
    if (!apps.some((a) => slug.includes(a))) continue;
    if (slug.replace(/-/g, '').includes(nc)) return slug;
  }
  return null;
}

// brand display + order (family key -> label)
const BRANDS = [
  ['whirlpool', 'Whirlpool / Maytag / KitchenAid'],
  ['samsung', 'Samsung'],
  ['lg', 'LG'],
  ['ge', 'GE / Hotpoint / Café'],
  ['frigidaire', 'Frigidaire / Electrolux'],
  ['bosch', 'Bosch'],
];
const APPL_ORDER = ['refrigerator', 'washer', 'dryer', 'dishwasher', 'range', 'freezer', 'any'];
const APPL_LABEL = { refrigerator: 'Refrigerator', washer: 'Washer', dryer: 'Dryer', dishwasher: 'Dishwasher', range: 'Range / Oven', freezer: 'Freezer', any: 'General' };

let guideCount = 0;
function brandSection(fam, label) {
  const mine = codes.filter((c) => c.family === fam);
  if (!mine.length) return '';
  const byAppl = {};
  for (const c of mine) { (byAppl[c.appliance] = byAppl[c.appliance] || []).push(c); }
  const apps = Object.keys(byAppl).sort((a, b) => APPL_ORDER.indexOf(a) - APPL_ORDER.indexOf(b));
  const blocks = apps.map((ap) => {
    const rows = byAppl[ap].map((c) => {
      const guide = findGuide(c.family, c.appliance, c.code);
      const link = guide ? ` <a class="g" href="/fix/${guide}.html">Full fix guide →</a>` : '';
      if (guide) guideCount++;
      return `      <div class="code${guide ? ' has' : ''}"><span class="c">${esc(c.code)}</span><span class="m">${esc(c.meaning)}${link}</span></div>`;
    }).join('\n');
    return `    <h3 class="ap">${esc(APPL_LABEL[ap] || ap)}</h3>\n    <div class="codes">\n${rows}\n    </div>`;
  }).join('\n');
  return `  <section class="brand">\n    <h2 id="${fam}">${esc(label)} error codes</h2>\n${blocks}\n  </section>`;
}

const sections = BRANDS.map(([f, l]) => brandSection(f, l)).join('\n');

const faqs = [
  { q: 'What do appliance error codes mean?', a: 'An error or fault code is your appliance telling you which system it thinks has a problem — a drain error, a fill error, a heat error, a sensor fault, and so on. It narrows down the cause, but the code is a starting point, not the whole diagnosis. This page lists what the common codes mean by brand.' },
  { q: 'How do I clear an appliance error code?', a: 'Many codes clear once the underlying issue is fixed — clean the filter, open the valve, clear the vent. For a one-time glitch, cutting power for a minute (unplug, or flip the breaker) often resets it. If the code comes right back, it\'s pointing at a real problem — find your code above for what to check.' },
  { q: 'Do the same codes mean the same thing on every brand?', a: 'No — a code like "F2" or "OE" means different things on different brands, and even different things across model years within a brand. Always match the code to your specific brand and appliance, which is how this reference is organized.' },
  { q: 'Can you fix my appliance if it\'s showing an error code?', a: 'Yes — we\'re a real technician-led shop, and error codes are our daily work. Start a $50 Quick Check with your code and a short video, and a real tech gives you an honest answer on what it is and what it costs. We serve Middle Tennessee and the Baton Rouge area in-home, plus nationwide video diagnostics.' },
];
const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: BASE + '/' }, { '@type': 'ListItem', position: 2, name: 'Appliance Error Codes', item: BASE + '/error-codes.html' }] };

const faqHtml = faqs.map((f) => `    <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n');
const brandNav = BRANDS.filter(([f]) => codes.some((c) => c.family === f)).map(([f, l]) => `<a href="#${f}">${esc(l.split(' / ')[0])}</a>`).join(' ');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Appliance Error Codes by Brand — What They Mean &amp; How to Fix | TN Appliance</title>
<meta name="description" content="What appliance error codes mean, by brand — Whirlpool, Samsung, LG, GE, Frigidaire, Bosch. Washer, dryer, refrigerator, dishwasher &amp; oven fault codes explained by real technicians, with fix guides. 24/7 help.">
<link rel="canonical" href="${BASE}/error-codes.html">
<meta name="robots" content="index,follow,max-snippet:-1">
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
<script type="application/ld+json">${JSON.stringify(bc)}</script>
<style>
  :root{ --bg:#0b0b0c; --surf:#141416; --bord:#26262a; --ink:#ececec; --ink2:#9a9aa2; --orange:#ff6200; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; line-height:1.5; }
  .wrap{ max-width:760px; margin:0 auto; padding:20px 18px 70px; }
  header{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px 0 18px; }
  .brand{ font-weight:800; color:var(--ink); text-decoration:none; font-size:16px; }
  .brand b{ color:var(--orange); }
  .callbtn{ font-size:13px; font-weight:700; color:var(--orange); text-decoration:none; border:1px solid var(--bord); border-radius:9px; padding:8px 12px; }
  .bc{ font-size:12px; color:var(--ink2); margin-bottom:10px; }
  .bc a{ color:var(--ink2); text-decoration:none; }
  h1{ font-size:30px; font-weight:800; letter-spacing:-.01em; line-height:1.12; margin-bottom:10px; text-wrap:balance; }
  .lede{ color:var(--ink2); font-size:16px; margin-bottom:18px; }
  .nav{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:22px; }
  .nav a{ font-size:13px; color:var(--orange); text-decoration:none; border:1px solid var(--bord); border-radius:8px; padding:7px 12px; background:var(--surf); }
  .brand h2{ font-size:19px; font-weight:800; margin:26px 0 4px; padding-bottom:8px; border-bottom:1px solid var(--bord); scroll-margin-top:14px; }
  .ap{ font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--orange); font-weight:700; margin:16px 0 8px; }
  .codes{ display:flex; flex-direction:column; gap:8px; }
  .code{ display:flex; gap:12px; align-items:baseline; background:var(--surf); border:1px solid var(--bord); border-radius:10px; padding:11px 13px; }
  .code.has{ border-color:rgba(255,98,0,.4); }
  .code .c{ font-weight:800; color:var(--ink); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:14px; min-width:58px; }
  .code .m{ font-size:14px; color:var(--ink2); }
  .code .g{ display:inline-block; margin-left:8px; color:var(--orange); font-weight:700; text-decoration:none; white-space:nowrap; }
  .cta{ background:linear-gradient(135deg, rgba(255,98,0,.14), rgba(255,98,0,.04)); border:1px solid rgba(255,98,0,.4); border-radius:16px; padding:22px; margin:30px 0 20px; text-align:center; }
  .cta h2{ font-size:20px; font-weight:800; margin-bottom:6px; border:none; padding:0; }
  .cta p{ color:var(--ink2); font-size:14px; margin-bottom:14px; }
  .btn{ display:inline-block; background:var(--orange); color:#fff; font-weight:800; text-decoration:none; padding:13px 24px; border-radius:12px; font-size:15px; }
  h2.faqh{ font-size:20px; font-weight:800; margin:28px 0 10px; }
  details{ background:var(--surf); border:1px solid var(--bord); border-radius:10px; padding:13px 15px; margin-bottom:8px; }
  summary{ font-weight:700; cursor:pointer; font-size:15px; }
  details p{ color:var(--ink2); font-size:14px; margin-top:8px; }
  footer{ margin-top:34px; padding-top:18px; border-top:1px solid var(--bord); color:var(--ink2); font-size:13px; }
  footer a{ color:var(--orange); text-decoration:none; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:+16152802949">Text or call 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/">Home</a> › Appliance Error Codes</nav>
    <h1>Appliance Error Codes — by brand, in plain English</h1>
    <p class="lede">Your appliance flashed a code and you want to know what it means. Here\'s the honest, technician-written rundown of the common fault codes by brand — what each one is telling you, and a full fix guide where we\'ve written one. Codes with a <span style="color:var(--orange);font-weight:700">Fix guide →</span> have step-by-step help.</p>
    <div class="nav">${brandNav}</div>
${sections}

    <div class="cta">
      <h2>Got a code we didn\'t list — or want it fixed?</h2>
      <p>We\'re real techs, and error codes are our everyday work. Send a short video with your code and get an honest answer + price.</p>
      <a class="btn" href="/?src=error-codes">Start your $50 Quick Check →</a>
    </div>

    <h2 class="faqh">Common questions</h2>
${faqHtml}

    <footer>
      <p><b>TN Appliance Exchange</b> — honest, technician-led appliance repair since 2012. In-home across Middle Tennessee &amp; the Baton Rouge area of Louisiana; nationwide video diagnostic with parts shipping. Reach us 24/7/365 at ${PHONE}.</p>
      <p style="margin-top:8px"><a href="/fix/">All appliance fix guides</a> · <a href="/">Home</a></p>
    </footer>
  </div>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'error-codes.html'), html);
console.log(`Wrote error-codes.html — ${codes.length} codes across ${BRANDS.length} brands, ${guideCount} linked to full guides.`);
