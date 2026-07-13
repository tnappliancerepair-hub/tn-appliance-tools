// build-troubleshooting-pages.js — renders the authority content library from
// scripts/troubleshooting-content.js into /fix/<slug>.html + a /fix/ hub index.
// Each page carries FAQPage + HowTo + BreadcrumbList schema so voice assistants and
// AI answer engines can quote it, and dual CTAs: local in-home repair (TN/LA) AND
// the nationwide video diagnostic (ship-you-the-part, works anywhere in the U.S.).
//
// Run:  node scripts/build-troubleshooting-pages.js
// Then bump sitemap.xml with the printed URLs and commit.
'use strict';
const fs = require('fs');
const path = require('path');
const ITEMS = require('./troubleshooting-content');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'fix');
const BASE = 'https://tnapplianceexchange.net';
const PHONE = '(615) 280-2949';
const TODAY = '2026-07-13';

const SERVICE_PAGE = { Washer: 'washer-repair.html', Dryer: 'dryer-repair.html', Refrigerator: 'refrigerator-repair.html', Dishwasher: 'dishwasher-repair.html', Oven: 'oven-repair.html' };

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

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
h1{font-size:clamp(26px,6vw,38px);line-height:1.15;margin:14px 0 6px;text-wrap:balance}
.lede{color:var(--dim);font-size:17px;margin:10px 0 22px}
h2{font-size:22px;margin:34px 0 6px;padding-top:8px}
p{margin:12px 0}
.safety{background:rgba(255,98,0,.08);border:1px solid rgba(255,98,0,.35);border-radius:10px;padding:12px 14px;font-size:14.5px;margin:18px 0}
.safety b{color:var(--orange)}
.cause{background:var(--surf);border:1px solid var(--bord);border-radius:12px;padding:16px 18px;margin:14px 0}
.cause h3{font-size:17px;margin:0 0 4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tag{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid var(--bord);color:var(--dim)}
.tag.Easy{color:#39ff14;border-color:rgba(57,255,20,.4)}
.tag.Moderate{color:#ffd23f;border-color:rgba(255,210,63,.4)}
.tag.Pro{color:var(--orange);border-color:rgba(255,98,0,.4)}
.cause .why{color:var(--ink);font-size:15px;margin:6px 0}
.cause .check{color:var(--dim);font-size:14px;margin-top:8px}
.cause .check b{color:var(--ink)}
.cta{background:linear-gradient(180deg,#161616,#0f0f0f);border:1px solid var(--bord);border-radius:16px;padding:22px;margin:30px 0}
.cta h2{margin:0 0 6px}
.cta p{font-size:15px;color:var(--dim);margin:6px 0 16px}
.btnrow{display:flex;gap:12px;flex-wrap:wrap}
.btn{flex:1 1 200px;text-align:center;text-decoration:none;font-weight:700;border-radius:12px;padding:15px 18px;font-size:15.5px}
.btn.p{background:var(--orange);color:#0b0b0c}
.btn.s{background:transparent;color:var(--ink);border:1px solid var(--bord)}
.faq{border-top:1px solid var(--bord);margin-top:8px}
details{border-bottom:1px solid var(--bord);padding:4px 0}
summary{cursor:pointer;font-weight:600;font-size:16px;padding:14px 0;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";float:right;color:var(--orange);font-weight:700}
details[open] summary::after{content:"–"}
details p{color:var(--dim);font-size:15px;padding:0 0 14px}
.related{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.related a{font-size:14px;color:var(--ink);text-decoration:none;background:var(--surf);border:1px solid var(--bord);border-radius:999px;padding:9px 14px}
.related a:hover{border-color:var(--orange)}
footer{border-top:1px solid var(--bord);margin-top:44px;padding:22px 0;color:var(--dim);font-size:13px}
footer a{color:var(--dim)}`;

function howToSteps(item) {
  const steps = item.causes.filter((c) => c.difficulty === 'Easy' || c.difficulty === 'Moderate')
    .map((c, i) => ({ '@type': 'HowToStep', position: i + 1, name: c.name, text: c.diy }));
  return steps.length ? {
    '@context': 'https://schema.org', '@type': 'HowTo',
    name: 'Safe things to check when ' + item.question.replace(/ — what do I do\?$/, '').toLowerCase(),
    about: item.appliance + ' repair',
    step: steps,
  } : null;
}

function page(item, idx) {
  const url = `${BASE}/fix/${item.slug}.html`;
  const svc = SERVICE_PAGE[item.appliance];
  const related = ITEMS.filter((x) => x.slug !== item.slug).slice(0, 3);

  const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: item.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: BASE + '/' },
    { '@type': 'ListItem', position: 2, name: 'Appliance Fix Guides', item: BASE + '/fix/' },
    { '@type': 'ListItem', position: 3, name: item.appliance + ' — ' + item.question.replace(/ — what do I do\?$/, ''), item: url },
  ] };
  const howto = howToSteps(item);

  const causesHtml = item.causes.map((c) => `      <div class="cause">
        <h3>${esc(c.name)} <span class="tag ${c.difficulty}">${c.difficulty === 'Pro' ? 'Technician' : c.difficulty + ' DIY check'}</span></h3>
        <p class="why">${esc(c.why)}</p>
        <p class="check"><b>Check it:</b> ${esc(c.diy)}</p>
      </div>`).join('\n');

  const faqHtml = item.faqs.map((f) => `        <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n');

  const relatedHtml = related.map((r) => `<a href="/fix/${r.slug}.html">${esc(r.question.replace(/ — what do I do\?$/, ''))}</a>`).join('\n        ')
    + (svc ? `\n        <a href="/${svc}">${esc(item.appliance)} repair service →</a>` : '');

  const schemas = [faqSchema, bc].concat(howto ? [howto] : []);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(item.metaTitle)} | TN Appliance Exchange</title>
<meta name="description" content="${esc(item.metaDesc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(item.metaTitle)}">
<meta property="og:description" content="${esc(item.metaDesc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
${schemas.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')}
<style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:+16152802949">Text or call 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/">Home</a> › <a href="/fix/">Appliance Fix Guides</a> › ${esc(item.appliance)}</nav>
    <h1>${esc(item.question)}</h1>
    <p class="lede">${esc(item.intro)}</p>
    <div class="safety"><b>⚠ Safety first:</b> ${esc(item.safety)}</div>

    <h2>The most likely causes</h2>
${causesHtml}

    <h2>Is it worth fixing?</h2>
    <p>${esc(item.repairReplace)}</p>

    <div class="cta">
      <h2>Get a real answer — anytime, anywhere</h2>
      <p>In Middle Tennessee or the Baton Rouge area? We'll come to you, same-day. Anywhere else in the U.S.? Send a 10-second video, a real technician tells you exactly what's wrong for $50 (credited toward the repair), and we ship you the exact part. 24/7 — text, call, or upload anytime.</p>
      <div class="btnrow">
        <a class="btn p" href="/">Start now — send a video</a>
        <a class="btn s" href="tel:+16152802949">Text or call ${PHONE}</a>
      </div>
    </div>

    <h2>Common questions</h2>
    <div class="faq">
${faqHtml}
    </div>

    <h2>Related fixes</h2>
    <div class="related">
        ${relatedHtml}
    </div>

    <footer>
      <p><b>TN Appliance Exchange</b> — honest, technician-led appliance repair since 2012. In-home service across Middle Tennessee &amp; the Baton Rouge area of Louisiana; nationwide video diagnostic with parts shipping. Reach us 24/7/365 at ${PHONE}.</p>
      <p style="margin-top:8px"><a href="/fix/">All appliance fix guides</a> · <a href="/">Home</a></p>
    </footer>
  </div>
</body>
</html>`;
}

function hub() {
  const byAppliance = {};
  for (const it of ITEMS) { (byAppliance[it.appliance] = byAppliance[it.appliance] || []).push(it); }
  const cards = ITEMS.map((it) => `      <a class="card" href="/fix/${it.slug}.html">
        <span class="ap">${esc(it.appliance)}</span>
        <span class="q">${esc(it.question.replace(/ — what do I do\?$/, ''))}</span>
      </a>`).join('\n');
  const itemList = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Appliance troubleshooting guides', itemListElement: ITEMS.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/fix/${it.slug}.html`, name: it.question })) };
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [ { '@type': 'ListItem', position: 1, name: 'Home', item: BASE + '/' }, { '@type': 'ListItem', position: 2, name: 'Appliance Fix Guides', item: BASE + '/fix/' } ] };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Appliance Fix Guides — Honest Answers From Real Technicians | TN Appliance Exchange</title>
<meta name="description" content="Straight answers to the most common appliance problems from working technicians. What's wrong, what's safe to check yourself, and whether it's worth fixing. 24/7 help anywhere in the U.S.">
<link rel="canonical" href="${BASE}/fix/">
<meta name="robots" content="index,follow,max-snippet:-1">
<script type="application/ld+json">${JSON.stringify(itemList)}</script>
<script type="application/ld+json">${JSON.stringify(bc)}</script>
<style>${CSS}
.grid{display:grid;grid-template-columns:1fr;gap:12px;margin:20px 0}
@media(min-width:560px){.grid{grid-template-columns:1fr 1fr}}
.card{display:flex;flex-direction:column;gap:6px;background:var(--surf);border:1px solid var(--bord);border-radius:14px;padding:18px;text-decoration:none}
.card:hover{border-color:var(--orange)}
.card .ap{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--orange);font-weight:700}
.card .q{font-size:17px;color:var(--ink);font-weight:600;line-height:1.3}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:+16152802949">Text or call 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/">Home</a> › Appliance Fix Guides</nav>
    <h1>Appliance Fix Guides</h1>
    <p class="lede">Straight, honest answers to the most common appliance problems — from technicians who fix these every day. What's likely wrong, what's safe to check yourself, and whether it's worth repairing. Stuck? Send us a video anytime and we'll tell you exactly what's going on.</p>
    <div class="grid">
${cards}
    </div>
    <div class="cta">
      <h2>Can't find your problem?</h2>
      <p>Describe it or send a 10-second video — 24/7, from anywhere in the U.S. A real technician answers, and we can ship you the exact part even if you're outside our in-home service area.</p>
      <div class="btnrow">
        <a class="btn p" href="/">Ask a technician now</a>
        <a class="btn s" href="tel:+16152802949">Text or call ${PHONE}</a>
      </div>
    </div>
    <footer><p><b>TN Appliance Exchange</b> — honest, technician-led appliance repair since 2012. 24/7/365 at ${PHONE}.</p></footer>
  </div>
</body>
</html>`;
}

// ---- write ----
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const urls = [];
ITEMS.forEach((it, i) => {
  fs.writeFileSync(path.join(OUT, it.slug + '.html'), page(it, i));
  urls.push(`${BASE}/fix/${it.slug}.html`);
});
fs.writeFileSync(path.join(OUT, 'index.html'), hub());
urls.unshift(`${BASE}/fix/`);
console.log('Built ' + ITEMS.length + ' fix pages + hub in /fix/');
console.log('SITEMAP_URLS:');
urls.forEach((u) => console.log(u));
