// build-en-metro-landers.js — English landers for the big appliance-repair METROS
// outside our on-site TN/LA area, plus the Tampa Bay cluster and Bedford KY / Trimble
// County. These sell the honest nationwide model: a real technician diagnoses your
// appliance by video ($50, credited), we ship the exact part to your door, and free
// DIY guides walk you through it. First-mover brand saturation — Ant's name 🐜 all over.
//
// Path: /repair/<slug>.html  + hub /repair/
// Metro priority informed by real Keyword Planner data (market-finder).
//
// Run:  node scripts/build-en-metro-landers.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'repair');
const BASE = 'https://tnapplianceexchange.net';
const PHONE = '1-888-268-8998';
const TEL = '+18882688998';
const QC = '/quick-check-intake.html';
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Real DIY guides we link into (internal authority) — the highest-volume symptoms.
const FIXES = [
  ['washer-wont-drain', "Washer won't drain"],
  ['dryer-not-heating', "Dryer runs but won't heat"],
  ['refrigerator-not-cooling', "Refrigerator not cooling"],
  ['dishwasher-wont-drain', "Dishwasher won't drain"],
  ['oven-not-heating', "Oven not heating"],
  ['washer-not-spinning', "Washer won't spin"],
];
const BRANDS = ['Whirlpool', 'Samsung', 'LG', 'GE', 'Frigidaire', 'Maytag', 'Kenmore', 'KitchenAid', 'Amana', 'Bosch'];

// Metros. group: 'metro' = big national market, 'tampa' = Tampa Bay saturation,
// 'ky' = Bedford / Trimble County KY. vol orders the hub. blurb = unique local line.
const METROS = [
  // --- Tampa Bay cluster (brand saturation — "all over Tampa") ---
  { name: 'Tampa', slug: 'tampa', st: 'FL', group: 'tampa', vol: 2200, blurb: 'Tampa, we\'re here for you. A real technician diagnoses your appliance by video and ships you the exact part — or walks you through fixing it yourself. Honest answers, no runaround.' },
  { name: 'St. Petersburg', slug: 'st-petersburg', st: 'FL', group: 'tampa', vol: 900, blurb: 'St. Pete homeowners: skip the overpriced service call. Show us the problem by video, get an honest diagnosis, and we ship the right part to your door.' },
  { name: 'Clearwater', slug: 'clearwater', st: 'FL', group: 'tampa', vol: 700, blurb: 'Clearwater — a real tech tells you what\'s actually wrong and what it\'ll cost before you spend a dime, all from your phone.' },
  { name: 'Brandon', slug: 'brandon', st: 'FL', group: 'tampa', vol: 500, blurb: 'Brandon and Valrico: get the exact part shipped to your door with a diagnosis you can trust — or a free guide to do it yourself.' },
  { name: 'Riverview', slug: 'riverview', st: 'FL', group: 'tampa', vol: 400, blurb: 'Riverview homeowners get honest, technician-led appliance help by video — and the right part shipped fast.' },
  { name: 'Wesley Chapel', slug: 'wesley-chapel', st: 'FL', group: 'tampa', vol: 400, blurb: 'Wesley Chapel: a broken appliance doesn\'t need an overpriced house call. Diagnose it by video, ship the part, done.' },
  { name: 'Lakeland', slug: 'lakeland', st: 'FL', group: 'tampa', vol: 500, blurb: 'Lakeland and Polk County — real technicians, honest diagnoses by video, and the exact part shipped to your door.' },
  { name: 'Sarasota', slug: 'sarasota', st: 'FL', group: 'tampa', vol: 500, blurb: 'Sarasota: get a straight answer on whether it\'s worth fixing before you spend money — from a real tech, by video.' },
  { name: 'Largo', slug: 'largo', st: 'FL', group: 'tampa', vol: 300, blurb: 'Largo homeowners get honest appliance help without the wait — video diagnosis and the right part to your door.' },
  { name: 'Palm Harbor', slug: 'palm-harbor', st: 'FL', group: 'tampa', vol: 200, blurb: 'Palm Harbor and Dunedin: skip the runaround. Show us the issue, get the truth, get the part.' },
  { name: 'Plant City', slug: 'plant-city', st: 'FL', group: 'tampa', vol: 200, blurb: 'Plant City — a real technician diagnoses your appliance by video and ships you the exact part you need.' },
  { name: 'Spring Hill', slug: 'spring-hill', st: 'FL', group: 'tampa', vol: 300, blurb: 'Spring Hill and Hernando County get honest, technician-led appliance help by video, with the part shipped fast.' },
  // --- Bedford KY / Trimble County ---
  { name: 'Bedford', slug: 'bedford-ky', st: 'KY', group: 'ky', vol: 90, blurb: 'Proudly here for Bedford and all of Trimble County. A real technician diagnoses your appliance by video and ships you the exact part — and if you want to try it yourself, we\'ll walk you through it. Small-town honest, no city markup.' },
  { name: 'Trimble County', slug: 'trimble-county-ky', st: 'KY', group: 'ky', vol: 70, blurb: 'From Bedford to Milton to Wises Landing — Trimble County gets honest, technician-led appliance help. Show us the problem by video, get a straight answer, and we ship the right part to your door.' },
  { name: 'Carrollton', slug: 'carrollton-ky', st: 'KY', group: 'ky', vol: 60, blurb: 'Carrollton and Carroll County: get an honest diagnosis from a real technician by video, and the exact part shipped to your door — no overpriced house call.' },
  // --- Top national English markets (real Keyword Planner volume) ---
  { name: 'New York', slug: 'new-york', st: 'NY', group: 'metro', vol: 11990, blurb: 'New York City — from the Bronx to Brooklyn, get an honest appliance diagnosis by video and the exact part shipped to your door, without waiting days for a service window.' },
  { name: 'Los Angeles', slug: 'los-angeles', st: 'CA', group: 'metro', vol: 7340, blurb: 'Los Angeles: skip the $150 service call. A real technician diagnoses your appliance by video and ships you the right part — or shows you how to fix it free.' },
  { name: 'Houston', slug: 'houston', st: 'TX', group: 'metro', vol: 7270, blurb: 'Houston homeowners get honest, technician-led appliance help by video and the exact part shipped fast — no runaround, no upsell.' },
  { name: 'Chicago', slug: 'chicago', st: 'IL', group: 'metro', vol: 5140, blurb: 'Chicago: a real tech tells you what\'s wrong and whether it\'s worth fixing before you spend a dime, all from your phone.' },
  { name: 'San Antonio', slug: 'san-antonio', st: 'TX', group: 'metro', vol: 3120, blurb: 'San Antonio homeowners get an honest video diagnosis and the exact part shipped to their door — repair it yourself or with our help.' },
  { name: 'Denver', slug: 'denver', st: 'CO', group: 'metro', vol: 3120, blurb: 'Denver: get a straight answer from a real technician by video, and the right part shipped fast — no overpriced house call.' },
  { name: 'Las Vegas', slug: 'las-vegas', st: 'NV', group: 'metro', vol: 2850, blurb: 'Las Vegas homeowners get honest, technician-led appliance help by video and the exact part to their door.' },
  { name: 'Phoenix', slug: 'phoenix', st: 'AZ', group: 'metro', vol: 2800, blurb: 'Phoenix: a broken appliance in the heat is an emergency. Get a fast, honest video diagnosis and the exact part shipped to you.' },
  { name: 'San Diego', slug: 'san-diego', st: 'CA', group: 'metro', vol: 2620, blurb: 'San Diego: skip the pricey service call. Show us the problem by video and get the truth plus the right part, shipped.' },
  { name: 'Dallas', slug: 'dallas', st: 'TX', group: 'metro', vol: 2610, blurb: 'Dallas–Fort Worth homeowners get an honest video diagnosis from a real tech and the exact part shipped to their door.' },
  { name: 'Atlanta', slug: 'atlanta', st: 'GA', group: 'metro', vol: 2540, blurb: 'Atlanta: get honest appliance answers by video and the exact part shipped fast — fix it yourself or with our guidance.' },
  { name: 'Miami', slug: 'miami', st: 'FL', group: 'metro', vol: 2270, blurb: 'Miami homeowners get a real technician\'s honest diagnosis by video and the exact part shipped to their door — en español también.' },
  { name: 'Orlando', slug: 'orlando', st: 'FL', group: 'metro', vol: 1820, blurb: 'Orlando: skip the runaround. A real tech diagnoses your appliance by video and ships you the right part.' },
  { name: 'Nashville', slug: 'nashville-national', st: 'TN', group: 'metro', vol: 1890, hide: true, blurb: '' }, // on-site handled elsewhere; skip
  // --- DC metro / tri-state (DMV): DC + Maryland + Northern Virginia ---
  { name: 'Washington', slug: 'washington-dc', st: 'DC', group: 'dmv', vol: 3500, blurb: 'Washington DC homeowners get honest, technician-led appliance help by video and the exact part shipped to your door — no overpriced service call, se habla español.' },
  { name: 'Arlington', slug: 'arlington-va', st: 'VA', group: 'dmv', vol: 1200, blurb: 'Arlington and Northern Virginia: a real tech diagnoses your appliance by video and ships you the right part — fix it yourself or with our help.' },
  { name: 'Alexandria', slug: 'alexandria-va', st: 'VA', group: 'dmv', vol: 1000, blurb: 'Alexandria homeowners get an honest video diagnosis and the exact part shipped fast — no runaround.' },
  { name: 'Silver Spring', slug: 'silver-spring', st: 'MD', group: 'dmv', vol: 1100, blurb: 'Silver Spring and Montgomery County: skip the pricey house call. Show us the problem by video, get the truth, get the part.' },
  { name: 'Rockville', slug: 'rockville', st: 'MD', group: 'dmv', vol: 900, blurb: 'Rockville homeowners get honest, technician-led appliance help by video and the exact part to their door.' },
  { name: 'Bethesda', slug: 'bethesda', st: 'MD', group: 'dmv', vol: 800, blurb: 'Bethesda: a real technician tells you what\'s wrong and whether it\'s worth fixing before you spend a dime, all from your phone.' },
  { name: 'Gaithersburg', slug: 'gaithersburg', st: 'MD', group: 'dmv', vol: 800, blurb: 'Gaithersburg and upper Montgomery County get honest appliance answers by video and the exact part shipped fast.' },
  { name: 'Fairfax', slug: 'fairfax-va', st: 'VA', group: 'dmv', vol: 900, blurb: 'Fairfax County homeowners get a real tech\'s honest diagnosis by video and the exact part shipped to their door.' },
  { name: 'Woodbridge', slug: 'woodbridge-va', st: 'VA', group: 'dmv', vol: 700, blurb: 'Woodbridge and Prince William County: honest, technician-led appliance help by video, with the part shipped fast.' },
  { name: 'Baltimore', slug: 'baltimore', st: 'MD', group: 'dmv', vol: 2600, blurb: 'Baltimore homeowners get an honest video diagnosis from a real tech and the exact part shipped to their door — no overpriced service call.' },
  { name: 'Frederick', slug: 'frederick-md', st: 'MD', group: 'dmv', vol: 600, blurb: 'Frederick and western Maryland get honest appliance help by video and the exact part shipped to your door.' },
];

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0b0b0c;--surf:#141416;--bord:#26262a;--ink:#ececec;--dim:#a0a0a6;--orange:#ff6200;--green:#39ff14}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.65;padding:0 18px 72px}
.wrap{max-width:760px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid var(--bord);position:sticky;top:0;background:var(--bg);z-index:5}
.brand{font-weight:800;letter-spacing:.02em;color:var(--ink);text-decoration:none;font-size:18px}
.brand b{color:var(--orange)}
.callbtn{font-size:13px;color:var(--ink);text-decoration:none;border:1px solid var(--bord);border-radius:8px;padding:8px 12px;white-space:nowrap}
nav.bc{font-size:12.5px;color:var(--dim);padding:16px 0 4px}
nav.bc a{color:var(--dim);text-decoration:none}
h1{font-size:clamp(26px,6vw,38px);line-height:1.14;margin:14px 0 8px;text-wrap:balance}
h1 .a{color:var(--green)}
.lede{color:var(--dim);font-size:17px;margin:10px 0 22px}
h2{font-size:22px;margin:34px 0 10px}
p{margin:12px 0}
.badges{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px}
.badge{font-size:12px;color:var(--dim);border:1px solid var(--bord);border-radius:999px;padding:6px 11px}
.steps{display:grid;grid-template-columns:1fr;gap:10px;margin:14px 0}
@media(min-width:560px){.steps{grid-template-columns:1fr 1fr 1fr}}
.step{background:var(--surf);border:1px solid var(--bord);border-radius:12px;padding:14px 16px}
.step .n{color:var(--orange);font-weight:800;font-size:13px}
.step h3{font-size:15px;margin:6px 0 4px}
.step p{font-size:13.5px;color:var(--dim);margin:0}
.problems{display:grid;grid-template-columns:1fr;gap:10px;margin:12px 0}
@media(min-width:560px){.problems{grid-template-columns:1fr 1fr}}
.problems a{display:block;background:var(--surf);border:1px solid var(--bord);border-radius:12px;padding:14px 16px;color:var(--ink);text-decoration:none;font-size:15px}
.problems a:hover{border-color:var(--orange)}
.problems a b{color:var(--orange);font-weight:600;font-size:12px;display:block;margin-top:4px}
.cta{background:linear-gradient(180deg,#161616,#0f0f0f);border:1px solid var(--bord);border-radius:16px;padding:22px;margin:30px 0}
.cta h2{margin:0 0 6px}
.cta p{font-size:15px;color:var(--dim);margin:6px 0 16px}
.btnrow{display:flex;gap:12px;flex-wrap:wrap}
.btn{flex:1 1 220px;text-align:center;text-decoration:none;font-weight:700;border-radius:12px;padding:15px 18px;font-size:15.5px}
.btn.p{background:var(--orange);color:#0b0b0c}
.btn.s{background:transparent;color:var(--ink);border:1px solid var(--bord)}
.faq{border-top:1px solid var(--bord);margin-top:8px}
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

function ctaBlock() {
  return `    <div class="cta">
      <h2>Start now — right from your phone</h2>
      <p>With the <b>$50 Quick Check</b> you send a short video and a photo of the model number. A real technician tells you exactly what's wrong and your options — and the $50 is credited toward the part or repair. We ship the exact part to your door, or walk you through fixing it yourself.</p>
      <div class="btnrow">
        <a class="btn p" href="${QC}">Start your $50 Quick Check →</a>
        <a class="btn s" href="tel:${TEL}">Call or text us · ${PHONE}</a>
      </div>
    </div>`;
}

function lander(m, siblings) {
  const url = `${BASE}/repair/${m.slug}.html`;
  const areaLabel = m.group === 'ky' && m.slug === 'trimble-county-ky' ? `${m.name}, ${m.st}` : `${m.name}, ${m.st}`;
  const title = `Appliance Repair in ${areaLabel} — Honest Diagnosis, Parts Shipped`;
  const metaDesc = `Appliance broken in ${m.name}, ${m.st}? A real technician diagnoses it by video ($50, credited to your repair), we ship the exact part to your door, and free DIY guides walk you through it. Call ${PHONE}.`;
  const problems = FIXES.map(([slug, txt]) => `      <a href="/fix/${slug}.html">${esc(txt)}<b>Read the free guide →</b></a>`).join('\n');
  const near = siblings.slice(0, 8).map((x) => `<a href="/repair/${x.slug}.html">${esc(x.name)}</a>`).join('\n        ');

  const svc = { '@context': 'https://schema.org', '@type': 'Service', name: `Appliance repair by video diagnosis + parts shipping — ${m.name}`,
    serviceType: 'Appliance repair (video diagnosis + parts shipping)', provider: { '@type': 'Organization', name: 'TN Appliance Exchange', telephone: TEL, url: BASE + '/' },
    areaServed: { '@type': m.slug === 'trimble-county-ky' ? 'AdministrativeArea' : 'City', name: m.name, addressRegion: m.st, addressCountry: 'US' }, url,
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '1082' } };
  const faqs = [
    { q: `Do you come to my house in ${m.name}?`, a: `We help ${m.name} homeowners nationwide by video diagnosis and by shipping the exact part to your door — that's how we keep it fast and affordable without the overpriced service call. For on-site service availability, call or text us at ${PHONE} and we'll let you know what's possible in your area.` },
    { q: `How does the $50 Quick Check work?`, a: `You send a short video of the problem and a photo of the model number. A real technician reviews it and gives you an honest diagnosis with your options and price. The $50 is credited toward the part or repair. It's all done from your phone.` },
    { q: `Can you ship the part to ${m.name}?`, a: `Yes. We ship parts anywhere in the U.S., including ${m.name}. Once we know your model and the failure, we send the correct part to your door — no guessing, no buying the wrong one.` },
    { q: `Is it worth repairing my appliance?`, a: `That's exactly what the Quick Check answers. A real technician gives you the honest repair-vs-replace comparison before you spend money — we'd rather save you a bad purchase than sell you a bad repair. We work with all major brands: ${BRANDS.slice(0, 6).join(', ')} and more.` },
    { q: `Can I fix it myself?`, a: `Often yes, and we help you do it. We have free troubleshooting guides for the most common failures, and if you need the part we ship it with instructions. You decide how much you want to do.` },
  ];
  const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: BASE + '/' },
    { '@type': 'ListItem', position: 2, name: 'Appliance Repair by City', item: BASE + '/repair/' },
    { '@type': 'ListItem', position: 3, name: title, item: url } ] };
  const faqHtml = faqs.map((f) => `        <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | TN Appliance Exchange</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<script type="application/ld+json">${JSON.stringify(svc)}</script>
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
<script type="application/ld+json">${JSON.stringify(bc)}</script>
<style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:${TEL}">Call or text 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/">Home</a> › <a href="/repair/">Repair by City</a> › ${esc(m.name)}</nav>
    <h1>Appliance Repair in <span class="a">${esc(areaLabel)}</span></h1>
    <div class="lede">${esc(m.blurb)}</div>
    <div class="badges"><span class="badge">📹 $50 video diagnosis (credited)</span><span class="badge">📦 Exact part shipped to your door</span><span class="badge">🔧 Free DIY guides</span><span class="badge">🐜 Family-owned since 2012 · 4.5★ (1,082 reviews)</span></div>

    <h2>How we help ${esc(m.name)}</h2>
    <div class="steps">
      <div class="step"><div class="n">1</div><h3>Show us the problem</h3><p>A short video and a photo of the model number, right from your phone.</p></div>
      <div class="step"><div class="n">2</div><h3>A real tech tells you the truth</h3><p>Honest diagnosis, your options, and the price — we don't guess and we don't upsell.</p></div>
      <div class="step"><div class="n">3</div><h3>We ship the exact part</h3><p>The right part arrives at your door with instructions — or we guide you through the fix.</p></div>
    </div>

    <h2>Free troubleshooting guides</h2>
    <p>These are the failures we see most. Tap one for the free guide — we tell you what's safe to check yourself and when it's time for the part or a pro:</p>
    <div class="problems">
${problems}
    </div>

    <h2>Repair or replace — we tell you the truth</h2>
    <p>Not everything is worth fixing, and we don't want you spending money you don't need to. With the $50 Quick Check, a real technician reviews your video and gives you the honest comparison first. We work with every major brand: ${esc(BRANDS.join(', '))} and more.</p>

${ctaBlock()}

    <h2>Frequently asked questions — ${esc(m.name)}</h2>
    <div class="faq">
${faqHtml}
    </div>

    <h2>Nearby areas</h2>
    <div class="near">
        ${near}
    </div>

    <footer>
      <p><b>TN Appliance Exchange</b> — honest, technician-led appliance repair since 2012. In ${esc(m.name)} we help by video diagnosis and ship parts nationwide. Call or text ${PHONE}. <span style="opacity:.7">Se habla español.</span></p>
      <p style="margin-top:8px"><a href="/repair/">All cities</a> · <a href="/fix/">Repair guides</a> · <a href="/">Home</a></p>
    </footer>
  </div>
</body>
</html>`;
}

function hub(list) {
  const groups = [
    { key: 'tampa', label: 'Tampa Bay & Central Florida' },
    { key: 'dmv', label: 'Washington DC, Maryland & Northern Virginia' },
    { key: 'ky', label: 'Bedford & Trimble County, Kentucky' },
    { key: 'metro', label: 'Major U.S. metros' },
  ];
  const sections = groups.map((g) => {
    const items = list.filter((m) => m.group === g.key).sort((a, b) => b.vol - a.vol);
    if (!items.length) return '';
    const cards = items.map((m) => `      <a href="/repair/${m.slug}.html" class="mcard"><h3>${esc(m.name)}, ${esc(m.st)}</h3><p>${esc(m.blurb.slice(0, 88))}…</p></a>`).join('\n');
    return `    <h2>${esc(g.label)}</h2>\n    <div class="mgrid">\n${cards}\n    </div>`;
  }).join('\n');
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [ { '@type': 'ListItem', position: 1, name: 'Home', item: BASE + '/' }, { '@type': 'ListItem', position: 2, name: 'Appliance Repair by City', item: BASE + '/repair/' } ] };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Appliance Repair Near You — Video Diagnosis + Parts Shipped Nationwide | TN Appliance Exchange</title>
<meta name="description" content="Honest, technician-led appliance repair anywhere in the U.S.: $50 video diagnosis (credited), the exact part shipped to your door, and free DIY guides. Tampa, Bedford KY, and major metros. ${PHONE}.">
<link rel="canonical" href="${BASE}/repair/">
<meta name="robots" content="index,follow,max-snippet:-1">
<script type="application/ld+json">${JSON.stringify(bc)}</script>
<style>${CSS}
.mgrid{display:grid;grid-template-columns:1fr;gap:10px;margin:14px 0}
@media(min-width:560px){.mgrid{grid-template-columns:1fr 1fr}}
.mcard{display:block;background:var(--surf);border:1px solid var(--bord);border-radius:12px;padding:14px 16px;text-decoration:none;color:var(--ink)}
.mcard:hover{border-color:var(--orange)}
.mcard h3{font-size:16px;color:var(--orange);margin:0 0 4px}
.mcard p{font-size:13px;color:var(--dim);margin:0}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:${TEL}">Call or text 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/">Home</a> › Repair by City</nav>
    <h1>Appliance repair <span class="a">near you</span> — nationwide</h1>
    <div class="lede">A real technician diagnoses your appliance by video ($50, credited to your repair), we ship the exact part to your door, and you get free DIY guides. Pick your city or start right now.</div>
${ctaBlock()}
${sections}
    <footer><p><b>TN Appliance Exchange</b> — honest repair led by real technicians since 2012. Parts shipped nationwide. ${PHONE}. <a href="/fix/">Repair guides</a> · <a href="/">Home</a> · <a href="/es/diagnostico/">En español</a></p></footer>
  </div>
</body>
</html>`;
}

// ---- write ----
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const live = METROS.filter((m) => !m.hide);
const urls = [];
for (const m of live) {
  const siblings = live.filter((x) => x.slug !== m.slug && (x.group === m.group || m.group === 'metro'));
  const sib = siblings.length ? siblings : live.filter((x) => x.slug !== m.slug);
  fs.writeFileSync(path.join(OUT, `${m.slug}.html`), lander(m, sib));
  urls.push(`${BASE}/repair/${m.slug}.html`);
}
fs.writeFileSync(path.join(OUT, 'index.html'), hub(live));
urls.push(`${BASE}/repair/`);
console.log('Wrote ' + urls.length + ' English metro landers (' + live.length + ' metros + hub) to /repair/');
fs.writeFileSync(path.join(__dirname, '.en-metro-lander-urls.txt'), urls.join('\n'));
