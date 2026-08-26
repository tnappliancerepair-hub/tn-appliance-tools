// 4U Appliance Repair — Louisiana content-network generator.
// Produces appliance service hubs, /fix/ symptom authority pages, and New
// Orleans-metro city pages from structured data, plus sitemap/robots/llms.
// All internal links are RELATIVE so the whole site is portable from
// tnapplianceexchange.net/sites/4u-appliance-repair/ to applianceman504.com.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOMAIN = 'https://applianceman504.com';
// Official name matches Andre's Google Business Profile + Facebook exactly
// (NAP consistency = a top local-SEO signal). "Appliance Repair" stays as the
// keyword descriptor in titles/taglines.
const NAME = '4U Repair & Services';         // plain — for JSON / enc()'d strings
const NAME_H = '4U Repair &amp; Services';   // for raw HTML template literals
const NAME_LEGAL = '4U Repair & Services LLC';
const PHONE_TEL = '+15049099413';
const PHONE = '(504) 909-9413';
const TN = 'https://tnapplianceexchange.net';

const enc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

// ---- shared stylesheet (same tokens as the home page, leaner) -------------
const CSS = `
:root{--bg:#eef1ec;--panel:#fff;--ink:#15201d;--muted:#586863;--line:#dfe5df;--brass:#b47f1f;--brass-soft:#f6ecd7;--pine:#0f2e2a;--pine-soft:#e2ece9;--hero:#0f2e2a;--hero-ink:#f2f6f3;--hero-muted:#9fb5ae;--shadow:0 1px 2px rgba(15,46,42,.06),0 12px 32px rgba(15,46,42,.09)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b1513;--panel:#132220;--ink:#eaf1ee;--muted:#93a8a1;--line:#22302d;--brass:#e0ad4e;--brass-soft:#2a2110;--pine:#08201c;--pine-soft:#12312c;--hero:#061613;--hero-ink:#f2f6f3;--hero-muted:#8ba59d;--shadow:0 1px 2px rgba(0,0,0,.5),0 14px 36px rgba(0,0,0,.45)}}
:root[data-theme="dark"]{--bg:#0b1513;--panel:#132220;--ink:#eaf1ee;--muted:#93a8a1;--line:#22302d;--brass:#e0ad4e;--brass-soft:#2a2110;--pine:#08201c;--pine-soft:#12312c;--hero:#061613;--hero-ink:#f2f6f3;--hero-muted:#8ba59d;--shadow:0 1px 2px rgba(0,0,0,.5),0 14px 36px rgba(0,0,0,.45)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:960px;margin:0 auto;padding:0 clamp(18px,4vw,36px)}
a{color:inherit}
h1,h2,h3,h4,.disp{font-family:"Anton","Inter",sans-serif;font-weight:400;letter-spacing:.01em;text-transform:uppercase}
.btn{display:inline-flex;align-items:center;gap:9px;background:var(--brass);color:#1c1403;font-weight:700;font-size:16px;text-decoration:none;padding:13px 22px;border-radius:10px;box-shadow:var(--shadow);transition:transform .12s ease}
.btn:hover{transform:translateY(-1px)}
.btn.ghost{background:transparent;color:var(--hero-ink);border:1.5px solid rgba(242,246,243,.26);box-shadow:none}
header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.hrow{display:flex;align-items:center;justify-content:space-between;padding:12px 0}
.brand{display:flex;align-items:center;gap:11px;font-family:"Anton",sans-serif;font-size:21px;letter-spacing:.02em;text-transform:uppercase;text-decoration:none}
.brand .mk{width:34px;height:34px;border-radius:9px;background:var(--brass);color:#1c1403;display:grid;place-items:center;font-size:19px}
.brand small{display:block;font-family:"Space Mono",monospace;font-size:9.5px;letter-spacing:.12em;color:var(--muted);font-weight:400;margin-top:-1px;text-transform:none}
.hcall{display:inline-flex;align-items:center;gap:8px;background:var(--brass);color:#1c1403;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:9px;font-size:15px}
@media(max-width:560px){.hcall span.lbl{display:none}}
.hero{background:var(--hero);color:var(--hero-ink);position:relative;overflow:hidden}
.hero::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 85% -10%,rgba(180,127,31,.14),transparent 60%)}
.hero .wrap{position:relative;z-index:1;padding:clamp(30px,5vw,52px) clamp(18px,4vw,36px) clamp(30px,5vw,50px)}
.crumb{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.04em;color:var(--hero-muted);margin:0 0 14px}
.crumb a{color:var(--brass);text-decoration:none}.crumb a:hover{text-decoration:underline}
.kicker{display:inline-flex;align-items:center;gap:8px;font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:var(--brass);margin:0 0 14px}
.kicker::before{content:"";width:22px;height:2px;background:var(--brass)}
h1{font-size:clamp(32px,6vw,56px);line-height:.98;margin:0 0 14px;text-wrap:balance}
h1 .o{color:var(--brass)}
.hero p.sub{font-size:clamp(16px,2.2vw,19px);color:var(--hero-muted);max-width:60ch;margin:0 0 24px}
.cta-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.promise{margin:20px 0 0;font-size:13.5px;color:var(--hero-muted);font-family:"Space Mono",monospace}
section{padding:clamp(38px,6vw,60px) 0}
.eyebrow{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:var(--brass);margin:0 0 10px}
h2{font-size:clamp(26px,4.4vw,40px);line-height:1.02;margin:0 0 8px;text-wrap:balance}
h3{font-size:20px;margin:0 0 6px}
p.lead{color:var(--muted);max-width:64ch;margin:0 0 26px;font-size:16.5px}
.prose{max-width:66ch}
.prose p{color:var(--muted);font-size:16.5px;margin:0 0 16px}
.prose p strong,.prose li strong{color:var(--ink)}
.grid{display:grid;gap:16px;grid-template-columns:1fr}
@media(min-width:620px){.grid.c2{grid-template-columns:1fr 1fr}.grid.c3{grid-template-columns:1fr 1fr}}
@media(min-width:900px){.grid.c3{grid-template-columns:1fr 1fr 1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px 20px;box-shadow:var(--shadow)}
.card .ic{font-size:24px;margin-bottom:8px;display:block}
.card h3{font-size:19px;margin:0 0 6px}
.card p{margin:0;font-size:14.5px;color:var(--muted)}
.card a.more{display:inline-block;margin-top:12px;color:var(--brass);text-decoration:none;font-weight:700;font-size:14px}
.checklist{list-style:none;padding:0;margin:0 0 8px;max-width:66ch}
.checklist li{position:relative;padding:14px 16px 14px 46px;background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:11px;box-shadow:var(--shadow);font-size:15.5px}
.checklist li::before{content:counter(step);counter-increment:step;position:absolute;left:12px;top:12px;width:24px;height:24px;border-radius:7px;background:var(--brass);color:#1c1403;font-family:"Anton",sans-serif;font-size:14px;display:grid;place-items:center}
.checklist{counter-reset:step}
.checklist li b{color:var(--ink)}
.causes{list-style:none;padding:0;margin:0 0 8px;max-width:66ch}
.causes li{padding:14px 0;border-top:1px solid var(--line);font-size:15.5px;color:var(--muted)}
.causes li:first-child{border-top:0}
.causes li b{color:var(--ink);display:block;font-family:"Anton",sans-serif;text-transform:uppercase;letter-spacing:.01em;font-size:15px;margin-bottom:2px}
.pro{background:var(--brass-soft);border:1px solid var(--brass);border-radius:14px;padding:20px 22px;max-width:66ch;margin:8px 0 0}
.pro b{color:var(--ink)}
.pro p{margin:0;color:var(--ink);font-size:15.5px}
.chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:8px}
.chips a,.chips span{font-family:"Space Mono",monospace;font-size:13px;background:var(--pine-soft);border:1px solid var(--line);border-radius:999px;padding:7px 14px;text-decoration:none}
.chips a:hover{border-color:var(--brass)}
.area{background:var(--hero);color:var(--hero-ink)}
.area h2{color:var(--hero-ink)}.area p{color:var(--hero-muted)}
.area .chips a,.area .chips span{background:rgba(242,246,243,.07);border-color:rgba(242,246,243,.14);color:var(--hero-ink)}
.faq details{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:11px;box-shadow:var(--shadow);overflow:hidden}
.faq summary{cursor:pointer;list-style:none;padding:17px 20px;font-weight:700;font-size:16px;display:flex;justify-content:space-between;gap:14px;align-items:center}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--brass);font-size:22px;font-weight:700;line-height:1}
.faq details[open] summary::after{content:"–"}
.faq .a{padding:0 20px 18px;color:var(--muted);font-size:15.5px;max-width:66ch}
.band{background:var(--brass);color:#1c1403;text-align:center}
.band h2{color:#1c1403}.band p{color:rgba(28,20,3,.82);max-width:50ch;margin:0 auto 22px;font-size:17px}
.band .phone{display:block;font-family:"Anton",sans-serif;font-size:clamp(30px,6vw,48px);letter-spacing:.02em;margin:4px 0 18px;color:#1c1403;text-decoration:none}
.band .btn{background:#0f2e2a;color:#f2f6f3}
footer{background:var(--hero);color:var(--hero-muted);padding:38px 0;font-size:14px}
footer .frow{display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between;align-items:flex-start}
footer .fb{font-family:"Anton",sans-serif;font-size:21px;text-transform:uppercase;color:var(--hero-ink);letter-spacing:.02em}
footer a{color:var(--hero-ink);text-decoration:none}
footer .links{display:flex;flex-wrap:wrap;gap:6px 14px;max-width:520px;font-size:13px}
footer .links a{color:var(--hero-muted)}footer .links a:hover{color:var(--brass)}
.network{margin-top:22px;padding-top:16px;border-top:1px solid rgba(242,246,243,.1);font-size:13.5px;color:var(--hero-muted)}
.network a{color:var(--brass);font-weight:600}
.disc{margin-top:14px;font-family:"Space Mono",monospace;font-size:11px;color:var(--hero-muted)}
`;

const HEAD_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&family=Space+Mono&display=swap" rel="stylesheet">`;
const FAVICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%F0%9F%90%9C</text></svg>">`;

function header(base) {
  return `<header><div class="wrap hrow">
  <a class="brand" href="${base || './'}"><span class="mk">🐜</span><span>${NAME_H}<small>New Orleans Appliance Repair</small></span></a>
  <a class="hcall" href="tel:${PHONE_TEL}">📞 <span class="lbl">Call&nbsp;</span>${PHONE}</a>
</div></header>`;
}

function footer(base, cityLinks) {
  const b = base || '';
  const links = cityLinks || [
    ['New Orleans', 'new-orleans'], ['Metairie', 'metairie'], ['Kenner', 'kenner'],
    ['Gretna', 'gretna'], ['Marrero', 'marrero'], ['Slidell', 'slidell'],
    ['Mandeville', 'mandeville'], ['Chalmette', 'chalmette'],
  ];
  return `<footer><div class="wrap">
  <div class="frow">
    <div>
      <div class="fb">🐜 ${NAME_H}</div>
      <p style="margin:8px 0 0">Family-run appliance repair<br>Greater New Orleans, Louisiana · named for Ant</p>
      <p style="margin:10px 0 0"><a href="tel:${PHONE_TEL}"><strong style="color:var(--hero-ink)">📞 ${PHONE}</strong></a></p>
    </div>
    <div class="links">${links.map(([n, s]) => `<a href="${b}${s}.html">${n}</a>`).join('')}
      <a href="${b}refrigerator-repair.html">Refrigerator Repair</a><a href="${b}washer-repair.html">Washer Repair</a><a href="${b}dryer-repair.html">Dryer Repair</a><a href="${b}oven-repair.html">Oven Repair</a><a href="${b}dishwasher-repair.html">Dishwasher Repair</a>
    </div>
  </div>
  <p class="network">Part of the <strong>TN Appliance Exchange</strong> family — a family-owned, technician-led repair network serving Louisiana &amp; Middle Tennessee since 2012. Need service in Tennessee? Visit <a href="${TN}">tnapplianceexchange.net</a>.</p>
  <p class="disc">${NAME_LEGAL.replace('&', '&amp;')} · New Orleans, LA · Refrigerators · Washers · Dryers · Ovens · Dishwashers · Fast, honest, done right — for you.</p>
</div></footer>`;
}

function page({ title, desc, canon, extraHead = '', body, cityLinks, base = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${DOMAIN}/${canon}">
<meta property="og:type" content="website">
<meta property="og:title" content="${enc(title)}">
<meta property="og:description" content="${enc(desc)}">
<meta property="og:url" content="${DOMAIN}/${canon}">
<meta name="twitter:card" content="summary_large_image">
${FAVICON}
<title>${enc(title)}</title>
<meta name="description" content="${enc(desc)}">
${HEAD_FONTS}
${extraHead}
<style>${CSS}</style>
</head>
<body>
${header(base)}
${body}
${footer(base, cityLinks)}
</body>
</html>`;
}

const ctaBand = (h, p) => `<section class="band"><div class="wrap">
  <h2>${h}</h2><p>${p}</p>
  <a class="phone" href="tel:${PHONE_TEL}">${PHONE}</a>
  <a class="btn" href="tel:${PHONE_TEL}">📞 Call ${NAME_H}</a>
</div></section>`;

const faqSection = (items) => `<section class="faq"><div class="wrap">
  <p class="eyebrow">Questions</p><h2>People also ask</h2>
  ${items.map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${f.q}</summary><div class="a">${f.a}</div></details>`).join('\n  ')}
</div></section>`;
const faqSchema = (items) => jsonld({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })) });

// =========================================================================
// DATA
// =========================================================================
const APPLIANCES = [
  { slug: 'refrigerator-repair', name: 'Refrigerator & Freezer Repair', short: 'Refrigerator Repair', emoji: '❄️',
    lede: 'A warm fridge is an emergency — hundreds of dollars of food on the line. 4U gets to New Orleans refrigerators fast and fixes the real cause, not just the symptom.',
    symptoms: ['Fridge not cooling / warm', 'Freezer not freezing', 'Leaking water on the floor', 'Ice maker not working', 'Loud buzzing or clicking', 'Frost buildup in the freezer', 'Running constantly', 'Water dispenser not working'],
    causes: 'Bad start relay or compressor, a failed evaporator or condenser fan, a clogged defrost system, a stuck damper, a leaking door seal, or a dirty condenser coil (a real problem in the Louisiana heat and humidity).',
    fixes: ['refrigerator-not-cooling', 'freezer-not-freezing', 'ice-maker-not-working'] },
  { slug: 'washer-repair', name: 'Washing Machine Repair', short: 'Washer Repair', emoji: '🌀',
    lede: 'Top-load or front-load, HE or old-school — if your washer won\'t spin, won\'t drain, leaks, or walks across the laundry room, 4U gets it washing right again.',
    symptoms: ['Won\'t spin or drain', 'Leaking water', 'Won\'t start or fill', 'Shaking / walking across the floor', 'Stuck on one cycle', 'Bad smell or mildew', 'Loud grinding on spin', 'Door or lid won\'t lock'],
    causes: 'A clogged drain pump or a sock stuck in it, a worn drive belt, a bad lid switch or door lock, failed shocks or suspension rods, a broken water-inlet valve, or a control board fault.',
    fixes: ['washer-wont-drain', 'washer-wont-spin'] },
  { slug: 'dryer-repair', name: 'Dryer Repair', short: 'Dryer Repair', emoji: '🔥',
    lede: 'No heat, taking three cycles to dry, or making a racket? 4U fixes electric and gas dryers so your clothes come out dry in one run — and your vent stays safe.',
    symptoms: ['No heat / not drying', 'Takes forever to dry', 'Loud thumping or squealing', 'Won\'t start or turn on', 'Shuts off mid-cycle', 'Drum won\'t turn', 'Too hot / burning smell', 'Clothes come out damp'],
    causes: 'A blown heating element or gas igniter, a failed thermal fuse or thermostat, a worn belt, bad rollers or a seized idler pulley, or — very often in Louisiana — a clogged vent choking airflow (also a fire risk worth checking).',
    fixes: ['dryer-not-heating'] },
  { slug: 'oven-repair', name: 'Oven, Range & Cooktop Repair', short: 'Oven Repair', emoji: '🍳',
    lede: 'Gas or electric — when the oven won\'t heat, bakes uneven, throws a fault code, or a burner dies, 4U gets dinner back on the table.',
    symptoms: ['Oven won\'t heat', 'Bakes uneven / wrong temp', 'Burner won\'t light (gas)', 'Element not heating (electric)', 'Error / fault code on display', 'Won\'t turn on', 'Broiler not working', 'Self-clean won\'t start'],
    causes: 'A burned-out bake or broil element, a failed igniter (the #1 gas-oven repair), a bad oven-temp sensor, a faulty control board, or a cracked surface-element switch on the cooktop.',
    fixes: ['oven-not-heating'] },
  { slug: 'dishwasher-repair', name: 'Dishwasher Repair', short: 'Dishwasher Repair', emoji: '🍽️',
    lede: 'Not draining, not cleaning, or leaking onto your floor? 4U gets your dishwasher running clean and quiet without you buying a new one.',
    symptoms: ['Not draining', 'Dishes come out dirty', 'Leaking onto the floor', 'Won\'t fill with water', 'Won\'t start / no power', 'Standing water in the bottom', 'Won\'t latch or close', 'Soap door won\'t open'],
    causes: 'A clogged drain pump or filter, a failed drain or inlet valve, worn spray arms or a bad wash pump, a leaking door gasket, or a control/touchpad fault.',
    fixes: ['dishwasher-not-draining'] },
];

const BRANDS = ['Whirlpool', 'GE', 'Samsung', 'LG', 'Maytag', 'Frigidaire', 'KitchenAid', 'Bosch', 'Kenmore', 'Amana', 'Electrolux', 'GE Profile'];

const FIXES = [
  { slug: 'refrigerator-not-cooling', appliance: 'refrigerator-repair', emoji: '❄️',
    title: 'Refrigerator Not Cooling? Here\'s What to Check', h1: 'Refrigerator not cooling',
    lede: 'A fridge that\'s running but not cold is one of the most common calls we get in New Orleans — and the cause is usually one of a handful of parts. Here\'s how to narrow it down safely before it costs you a fridge full of food.',
    causes: [['Dirty condenser coils', 'In Louisiana heat, coils caked with dust and pet hair can\'t shed heat, so the fridge runs but never gets cold. Cleaning them fixes a surprising number of "not cooling" calls.'],
      ['Evaporator fan not running', 'If the freezer is cold but the fridge is warm, the fan that moves cold air between them has usually failed. You\'ll often hear silence where a soft whir should be.'],
      ['Frozen defrost system', 'A failed defrost heater or timer lets frost pack the coils solid until air can\'t pass — the fridge slowly warms over a day or two.'],
      ['Start relay or compressor', 'If nothing is running at all and you hear a click every few minutes, the start relay or compressor may be the culprit — a tech-level fix.']],
    steps: [['Check the settings and the door', 'Make sure the temp dial wasn\'t bumped and the door is sealing — a warm kitchen and a weak gasket alone can warm a fridge.'],
      ['Pull it out and clean the coils', 'Unplug it, find the coils (back or bottom-front behind the kick plate), and vacuum them clean. Give it 24 hours to recover.'],
      ['Listen for the fans', 'Open the freezer and listen. Silence with a warm fridge points to a dead evaporator fan.'],
      ['Feel for airflow', 'No cold air coming through the freezer vents usually means a frost-blocked or fan problem — time to call.']],
    pro: 'If the coils are clean, the door seals, and it\'s still warm after a day — or you hear clicking with no cooling — the next steps involve sealed-system and electrical work. That\'s where 4U comes in: Andre pinpoints it and quotes you upfront before any parts.',
    faq: [{ q: 'How long does a fridge take to get cold after cleaning the coils?', a: 'Give it a full 24 hours. If it\'s still warm the next day, the coils weren\'t the (only) problem and it\'s time for a technician.' },
      { q: 'Is it worth repairing a fridge that isn\'t cooling?', a: 'Usually yes if the unit is under ~10 years old — most "not cooling" repairs (fans, relays, defrost parts) cost far less than a new fridge. Andre will tell you straight if yours isn\'t worth it.' },
      { q: 'Why is my freezer cold but the fridge warm?', a: 'That specific split almost always means the evaporator fan or the defrost system has failed, so cold air isn\'t reaching the fridge section. It\'s a common, fixable repair.' }] },
  { slug: 'freezer-not-freezing', appliance: 'refrigerator-repair', emoji: '🧊',
    title: 'Freezer Not Freezing? Common Causes & Fixes', h1: 'Freezer not freezing',
    lede: 'When a freezer won\'t hold temperature, food thaws and refreezes and you lose it. The good news: most causes are repairable parts, not a dead unit.',
    causes: [['Dirty condenser coils', 'Same story as the fridge — coils choked with dust can\'t release heat, and the freezer is the first to suffer.'],
      ['Bad door seal', 'A gasket that\'s cracked, warped, or not sealing lets warm, humid Gulf air pour in and frost everything up.'],
      ['Failed defrost system', 'A dead defrost heater or timer lets ice armor the coils until air can\'t move — the freezer slowly warms.'],
      ['Weak start relay or compressor', 'If it\'s not running at all, the relay or compressor is suspect and needs a technician.']],
    steps: [['Don\'t overpack it', 'A stuffed freezer blocks the vents. Leave room for air to circulate.'],
      ['Check the gasket', 'Close the door on a dollar bill — if it slides out with no drag, the seal is weak.'],
      ['Clean the coils', 'Unplug, vacuum the condenser coils, and give it a day.'],
      ['Look for frost patterns', 'Heavy frost on the back wall points to a defrost problem worth a service call.']],
    pro: 'If the seal is good and the coils are clean but it still won\'t freeze, the defrost system or sealed system needs a tech. Call Andre — he diagnoses it and gives you the honest number before touching a part.',
    faq: [{ q: 'Why is my freezer frosting up but not freezing food?', a: 'That points to a defrost-system failure — a bad defrost heater, thermostat, or timer lets frost block the coils. It\'s a standard repair.' },
      { q: 'Can a bad door seal really stop a freezer from freezing?', a: 'Yes — especially in humid New Orleans. A leaking gasket lets warm moist air in, which both raises the temperature and packs on frost.' }] },
  { slug: 'ice-maker-not-working', appliance: 'refrigerator-repair', emoji: '🧊',
    title: 'Ice Maker Not Working? How to Diagnose It', h1: 'Ice maker not making ice',
    lede: 'An ice maker that quits is annoying but usually cheap to fix — the trouble is almost always the water line, the valve, or the ice-maker module itself.',
    causes: [['Frozen or kinked water line', 'The thin fill line freezes or kinks and no water reaches the tray. Common and easy to confirm.'],
      ['Bad water inlet valve', 'The valve that lets water in fails electrically or clogs, so the tray never fills.'],
      ['Failed ice-maker module', 'The motor/module that cycles and ejects the cubes wears out and stops.'],
      ['Wrong freezer temp', 'If the freezer is above ~10°F, the maker won\'t cycle — fix the cold first.']],
    steps: [['Check it\'s turned on', 'Sounds obvious, but the arm or switch gets bumped off constantly.'],
      ['Confirm the freezer is cold enough', 'It needs to be at or below ~0–10°F to make ice.'],
      ['Look for a frozen fill line', 'A line iced solid is a common, findable cause.'],
      ['Test with a manual fill', 'If a cup of water in the tray freezes fine, the cooling is OK and it\'s the fill side — valve or line.']],
    pro: 'If the line and temp are fine, it\'s the inlet valve or the module — both quick fixes for a tech. Andre carries the common parts and can usually knock it out in one visit.',
    faq: [{ q: 'Is it worth fixing an ice maker?', a: 'Almost always — the common parts (valve, module, line) are inexpensive and a technician can usually fix it in a single visit, far cheaper than a new fridge.' },
      { q: 'Why did my ice maker stop after I changed the water filter?', a: 'A filter not seated right, or air in the line after a change, can stop the flow. Reseat the filter and run a few dispenses; if it doesn\'t recover, the valve may have stuck.' }] },
  { slug: 'washer-wont-drain', appliance: 'washer-repair', emoji: '💧',
    title: 'Washer Won\'t Drain? Here\'s How to Fix It', h1: 'Washer won\'t drain',
    lede: 'A washer full of standing water at the end of a cycle almost always comes down to a blockage or the pump — and one of them you can often clear yourself.',
    causes: [['Clogged drain pump filter', 'Coins, socks, hairpins, and lint collect in the pump filter until water can\'t get past. The #1 cause, especially on front-loaders.'],
      ['Object stuck in the pump', 'A small item wedged in the pump impeller stops it cold — you\'ll often hear a hum with no drain.'],
      ['Kinked or clogged drain hose', 'The hose behind the machine kinks or clogs where it meets the standpipe.'],
      ['Failed drain pump', 'The pump motor itself dies — no hum, no drain — and needs replacing.']],
    steps: [['Cut the power first', 'Unplug it before you go near the pump — safety first.'],
      ['Bail out the water', 'Scoop or towel out the standing water so you don\'t flood the floor.'],
      ['Find and clean the pump filter', 'On front-loaders it\'s behind a small door at the bottom front. Have a towel ready — water will come out.'],
      ['Check the drain hose', 'Pull the machine out, straighten any kinks, and make sure the hose isn\'t clogged.']],
    pro: 'If the filter and hose are clear but it still won\'t drain — or the pump just hums — the pump is likely shot. Andre replaces it and gets you back to laundry same or next day.',
    faq: [{ q: 'Where is the drain pump filter on a front-load washer?', a: 'Behind a small access panel at the bottom-front of the machine. Keep a shallow pan and towels handy — there\'s always trapped water behind it.' },
      { q: 'Why does my washer hum but not drain?', a: 'A hum with no drainage usually means something is jammed in the pump impeller, or the pump motor has failed. Both are standard repairs.' }] },
  { slug: 'washer-wont-spin', appliance: 'washer-repair', emoji: '🌀',
    title: 'Washer Won\'t Spin? Common Causes', h1: 'Washer won\'t spin',
    lede: 'Clothes coming out sopping wet means the spin cycle failed. It\'s usually the lid switch, the belt, or an unbalanced load — here\'s how to tell.',
    causes: [['Bad lid switch or door lock', 'The machine won\'t spin if it doesn\'t think the lid/door is safely shut. A worn switch is the most common cause.'],
      ['Unbalanced load', 'A wadded-up comforter throws the drum off balance and the machine refuses to spin up to protect itself.'],
      ['Worn or broken drive belt', 'The belt that turns the drum stretches or snaps, so the motor runs but the drum doesn\'t.'],
      ['Motor or control fault', 'A failing drive motor or control board stops the spin entirely.']],
    steps: [['Redistribute the load', 'Open it, spread the clothes evenly, and restart the spin — this alone fixes a lot of "won\'t spin" calls.'],
      ['Test the lid/door', 'Make sure it latches firmly. A lid that doesn\'t click shut won\'t let the machine spin.'],
      ['Listen when it tries to spin', 'Motor running but drum still means a belt; total silence points to the switch or control.'],
      ['Check for error codes', 'Note any code on the display — it narrows the fix fast.']],
    pro: 'If it\'s not the load or the lid, a technician needs to get inside for the belt, motor, or control. Andre diagnoses which and quotes it before ordering a part.',
    faq: [{ q: 'Why are my clothes soaking wet after the cycle?', a: 'The final spin didn\'t run — usually a lid/door switch, an unbalanced load, or a worn belt. Start by rebalancing the load and confirming the lid latches.' }] },
  { slug: 'dryer-not-heating', appliance: 'dryer-repair', emoji: '🔥',
    title: 'Dryer Not Heating? Here\'s What\'s Wrong', h1: 'Dryer runs but no heat',
    lede: 'When the drum spins but the clothes stay cold and damp, it\'s almost always a heating component or a blocked vent. Some of it you can check safely — some needs a tech and a meter.',
    causes: [['Clogged dryer vent', 'A vent packed with lint kills airflow, so the dryer can\'t exhaust or heat properly — and it\'s a genuine fire hazard. Always check this first.'],
      ['Blown thermal fuse', 'A restricted vent often trips the thermal fuse, which then kills the heat entirely. Common and inexpensive to replace.'],
      ['Failed heating element (electric)', 'The element burns out and the dryer tumbles cold.'],
      ['Bad igniter or gas valve (gas)', 'On a gas dryer, a weak igniter or failed valve coils means no flame, no heat.']],
    steps: [['Clean the lint screen every load', 'A clogged screen alone can choke the heat — clear it before anything else.'],
      ['Check the vent all the way out', 'Disconnect the vent and clear it back to the exterior flap. Weak or no air out the wall = a blockage.'],
      ['Confirm the setting', 'Make sure it\'s not on Air Fluff / no-heat.'],
      ['Note the breaker (electric)', 'An electric dryer on a half-tripped 240V breaker will tumble but not heat — reset it fully.']],
    pro: 'If the vent is clear and it still won\'t heat, it\'s the fuse, element, or gas igniter — all of which need a meter and teardown. Andre carries the common heat parts and usually fixes it in one visit.',
    faq: [{ q: 'Why does my dryer run but not heat?', a: 'The most common causes are a clogged vent, a blown thermal fuse, a burned-out heating element (electric), or a failed igniter (gas). Start by clearing the vent.' },
      { q: 'Can a clogged vent stop my dryer from heating?', a: 'Yes — and it\'s the first thing to check. A blocked vent chokes airflow and frequently trips the thermal fuse, which cuts the heat. It\'s also a fire risk, so keep it clear.' }] },
  { slug: 'oven-not-heating', appliance: 'oven-repair', emoji: '🍳',
    title: 'Oven Not Heating? Gas & Electric Fixes', h1: 'Oven won\'t heat',
    lede: 'An oven that won\'t come up to temperature is usually one failed part — the element, the igniter, or the temp sensor. Here\'s how to tell which, and what needs a pro.',
    causes: [['Burned-out bake element (electric)', 'If the element doesn\'t glow evenly orange — or has a visible break or blister — it\'s done.'],
      ['Weak igniter (gas)', 'The #1 gas-oven repair: a tired igniter glows but never gets hot enough to open the gas valve, so it clicks but won\'t light or heat.'],
      ['Bad oven temperature sensor', 'A failed sensor feeds the control the wrong reading, so the oven heats wrong or not at all — often with a fault code.'],
      ['Control board fault', 'The electronic control fails and won\'t call for heat.']],
    steps: [['Watch the element or igniter', 'Electric: does the bake element glow fully? Gas: does the igniter glow bright orange and light the burner within ~90 seconds?'],
      ['Note any error code', 'Write down the exact code — it points straight at the failed part.'],
      ['Rule out the clock/timer', 'A delay-bake or timer mode set by accident can lock out the oven — cancel and retry.'],
      ['Never bypass a gas safety', 'If a gas oven isn\'t lighting, don\'t force it — call.']],
    pro: 'Oven heat elements, igniters, and sensors carry live 240V or gas — this is a call-a-pro repair. Andre diagnoses the exact part, quotes it, and does it safely.',
    faq: [{ q: 'Why does my gas oven click but not light?', a: 'That\'s the classic sign of a weak igniter — it\'s drawing current (the click) but not getting hot enough to open the gas valve. It\'s the most common gas-oven repair and a straightforward fix.' },
      { q: 'Is it safe to fix an oven myself?', a: 'The safe DIY steps are checking the setting, the code, and whether the element glows. Anything past that involves 240V or gas and should be left to a technician.' }] },
  { slug: 'dishwasher-not-draining', appliance: 'dishwasher-repair', emoji: '🍽️',
    title: 'Dishwasher Not Draining? Clear It Step by Step', h1: 'Dishwasher won\'t drain',
    lede: 'Standing water in the bottom after a cycle is almost always a clog or a drain-path problem — and a lot of it you can clear at the sink before you ever call.',
    causes: [['Clogged filter', 'Food and grease pack the filter basket at the bottom until water can\'t get to the pump. The most common cause by far.'],
      ['Blocked drain hose or air gap', 'The hose to the disposal or the air gap on the counter clogs and backs water up.'],
      ['Disposal plug not knocked out', 'On a new disposal install, the knockout plug left in place blocks the dishwasher drain completely.'],
      ['Failed drain pump', 'The pump itself dies and can\'t push the water out.']],
    steps: [['Run the disposal first', 'A full or clogged disposal will back water into the dishwasher — run it, then retry.'],
      ['Clean the filter', 'Pull the bottom rack, twist out the filter basket, and rinse away the gunk. Do this monthly.'],
      ['Check the drain hose', 'Look under the sink for a kinked or clogged hose, and clear the air gap on the counter if you have one.'],
      ['Confirm the disposal knockout', 'If it\'s a recent disposal install and the dishwasher never drained since, the knockout plug is the likely culprit.']],
    pro: 'If the filter, hose, and disposal are all clear but water still stands, the drain pump or valve has failed. Andre replaces it and confirms it drains clean before he leaves.',
    faq: [{ q: 'Why is there water in the bottom of my dishwasher?', a: 'A shallow layer of standing water means it didn\'t drain — usually a clogged filter, a blocked drain hose, a full disposal, or a disposal knockout plug left in. Start by cleaning the filter and running the disposal.' },
      { q: 'How often should I clean my dishwasher filter?', a: 'About once a month. A clogged filter is the single most common cause of poor draining and poor cleaning, and it takes two minutes to rinse out.' }] },
];

const CITIES = [
  { slug: 'new-orleans', name: 'New Orleans', parish: 'Orleans Parish',
    areas: ['Uptown', 'Mid-City', 'Lakeview', 'Gentilly', 'the Marigny', 'Algiers', 'the Garden District', 'Bywater'],
    intro: 'New Orleans homes and their appliances take a beating — heat, humidity, and the occasional power blip are hard on compressors, control boards, and vents. 4U is a local, New Orleans-based repair service, so when your fridge quits or your dryer stops heating, you get a real technician on the way fast, not a call center in another state.' },
  { slug: 'metairie', name: 'Metairie', parish: 'Jefferson Parish',
    areas: ['Old Metairie', 'Bucktown', 'Fat City', 'along Veterans', 'near Lakeside'],
    intro: 'Metairie is right in 4U\'s backyard — quick to reach from anywhere in Jefferson Parish. Whether it\'s a washer that won\'t drain in Old Metairie or an oven out near Lakeside, Andre gets to you fast with honest, upfront pricing.' },
  { slug: 'kenner', name: 'Kenner', parish: 'Jefferson Parish',
    areas: ['near the airport', 'Rivertown', 'University City', 'along Williams Blvd'],
    intro: 'Kenner families count on 4U for fast, no-nonsense appliance repair. From Rivertown to University City, if your refrigerator, washer, dryer, or dishwasher is acting up, we\'ll get a technician out and tell you straight what it needs.' },
  { slug: 'gretna', name: 'Gretna', parish: 'Jefferson Parish (West Bank)',
    areas: ['Old Gretna', 'Timberlane', 'Terrytown edge', 'along Belle Chasse Hwy'],
    intro: 'Gretna and the West Bank are core 4U territory. Andre covers the West Bank daily, so a same- or next-day fridge or washer repair in Gretna is the norm, not the exception.' },
  { slug: 'marrero', name: 'Marrero', parish: 'Jefferson Parish (West Bank)',
    areas: ['Ames', 'Estelle', 'along Barataria Blvd', 'Westwood'],
    intro: 'Marrero homeowners get fast, local appliance repair from 4U. We\'re on the West Bank every day — so whether it\'s a dryer that won\'t heat or a dishwasher backing up, we\'re close by and quick to respond.' },
  { slug: 'harvey', name: 'Harvey', parish: 'Jefferson Parish (West Bank)',
    areas: ['along the Harvey Canal', 'Woodmere', 'near Manhattan Blvd'],
    intro: 'Harvey is minutes from 4U\'s West Bank routes. Andre keeps the common parts on the truck, so a lot of Harvey repairs — washers, dryers, fridges, ovens — get fixed in a single visit.' },
  { slug: 'westwego', name: 'Westwego', parish: 'Jefferson Parish (West Bank)',
    areas: ['Sala Ave', 'near Bridge City', 'along the West Bank Expressway'],
    intro: 'Westwego residents get honest, fast appliance repair from a local tech. 4U works the West Bank daily — no long waits, no run-around, just a straight answer and a fair price.' },
  { slug: 'chalmette', name: 'Chalmette', parish: 'St. Bernard Parish',
    areas: ['Old Arabi', 'along Judge Perez', 'Meraux edge'],
    intro: 'Chalmette and St. Bernard Parish are part of 4U\'s service area. When your appliance quits down in Da Parish, you don\'t have to wait a week — Andre gets out to Chalmette fast and fixes it right.' },
  { slug: 'slidell', name: 'Slidell', parish: 'St. Tammany Parish (North Shore)',
    areas: ['Olde Towne', 'Eden Isles', 'near Fremaux', 'Lakeshore'],
    intro: 'Across the lake in Slidell, 4U and the TN Appliance network keep the North Shore covered. Refrigerators, washers, dryers, and ovens — call and we\'ll confirm your Slidell appointment and get you a real technician.' },
  { slug: 'mandeville', name: 'Mandeville', parish: 'St. Tammany Parish (North Shore)',
    areas: ['Old Mandeville', 'along the lakefront', 'near Fontainebleau'],
    intro: 'Mandeville homeowners get technician-led appliance repair through 4U and the TN Appliance North Shore team. Honest diagnosis, upfront pricing, and no pressure — the way service should be.' },
  { slug: 'covington', name: 'Covington', parish: 'St. Tammany Parish (North Shore)',
    areas: ['downtown Covington', 'along Hwy 190', 'near the trace'],
    intro: 'Covington and the North Shore are covered by 4U\'s network. Whether it\'s a fridge not cooling or a dryer that quit, call and we\'ll line up an honest, upfront repair for your Covington home.' },
  { slug: 'terrytown', name: 'Terrytown', parish: 'Jefferson Parish (West Bank)',
    areas: ['near Oakwood', 'Stumpf Blvd', 'Carol Sue'],
    intro: 'Terrytown is right on 4U\'s West Bank routes — one of the quickest areas for us to reach. Same- or next-day appliance repair is the standard here.' },
  { slug: 'algiers', name: 'Algiers', parish: 'Orleans Parish (West Bank)',
    areas: ['Algiers Point', 'Aurora', 'Old Aurora', 'along Gen. de Gaulle'],
    intro: 'Algiers, right across the river, is core 4U territory. Andre works the West Bank daily, so getting a technician to Algiers for a fridge, washer, or oven repair is fast and easy.' },
  { slug: 'laplace', name: 'LaPlace', parish: 'St. John the Baptist Parish',
    areas: ['along Airline Hwy', 'Belle Terre', 'Cambridge'],
    intro: 'LaPlace and the River Parishes are part of 4U\'s reach. When your appliance goes out, call and we\'ll confirm we can get to you — chances are we can, and fast.' },
  { slug: 'houma', name: 'Houma', parish: 'Terrebonne Parish',
    areas: ['downtown Houma', 'along Martin Luther King Blvd', 'Bayou Cane'],
    intro: 'Houma and the bayou region are served through 4U and the TN Appliance network. Call to confirm your Houma appointment — we\'ll get you a real technician with honest, upfront pricing.' },
  { slug: 'baton-rouge', name: 'Baton Rouge', parish: 'East Baton Rouge Parish',
    areas: ['Mid City', 'the Garden District', 'along Perkins', 'near LSU'],
    intro: 'Baton Rouge is one of 4U\'s regular service areas — Andre runs the capital area right alongside New Orleans. When your fridge, washer, dryer, or oven quits, call and we\'ll get an honest, upfront repair scheduled for your Baton Rouge home fast.' },
];

// =========================================================================
// RENDERERS
// =========================================================================
function apById(slug) { return APPLIANCES.find((a) => a.slug === slug); }
function fxById(slug) { return FIXES.find((f) => f.slug === slug); }

function renderAppliance(a) {
  const relFix = a.fixes.map(fxById).filter(Boolean);
  const faq = [
    { q: `Do you repair all ${a.short.toLowerCase().replace(' repair', '')} brands?`, a: `Yes — ${BRANDS.slice(0, 8).join(', ')} and the rest. Have your model number handy and we'll bring the right part.` },
    { q: 'How fast can you come out?', a: 'Most of the time same or next day across the New Orleans metro. Call and Andre gets right back to you with a time.' },
    { q: 'Do you charge a service fee?', a: 'There\'s a service-call fee to come out and diagnose it, and it goes toward your repair when you have us do the fix. Andre goes over the price before any work starts.' },
    { q: `Is it worth repairing instead of replacing?`, a: 'Usually yes if the unit isn\'t too old — most repairs cost a fraction of a new appliance. Andre will tell you straight if yours isn\'t worth fixing.' },
  ];
  const schema = jsonld({ '@context': 'https://schema.org', '@type': 'Service', serviceType: a.name, provider: { '@type': 'LocalBusiness', name: NAME_LEGAL, telephone: PHONE_TEL, url: DOMAIN, areaServed: 'New Orleans, LA' }, areaServed: CITIES.slice(0, 12).map((c) => ({ '@type': 'City', name: c.name })), description: a.lede });
  const body = `
<div class="hero"><div class="wrap">
  <p class="crumb"><a href="./">Home</a> › ${enc(a.short)}</p>
  <p class="kicker">${a.emoji} New Orleans &amp; the West Bank</p>
  <h1>${enc(a.name)}</h1>
  <p class="sub">${a.lede}</p>
  <div class="cta-row"><a class="btn" href="tel:${PHONE_TEL}">📞 Call ${PHONE}</a><a class="btn ghost" href="#symptoms">Common problems</a></div>
  <p class="promise">Call and Andre gets right back to you — fast, honest, done right.</p>
</div></div>

<section id="symptoms"><div class="wrap">
  <p class="eyebrow">What we fix</p><h2>${enc(a.short)} problems we see every week</h2>
  <p class="lead">If your ${a.short.toLowerCase().replace(' repair', '')} is doing any of this, 4U can fix it — usually in a single visit.</p>
  <div class="chips">${a.symptoms.map((s) => `<span>${enc(s)}</span>`).join('')}</div>
  <div class="prose" style="margin-top:26px"><p><strong>The usual culprits:</strong> ${enc(a.causes)}</p></div>
</div></section>

${relFix.length ? `<section><div class="wrap">
  <p class="eyebrow">Fix-it guides</p><h2>Troubleshoot it yourself first</h2>
  <p class="lead">Honest, safe guides for the most common ${a.short.toLowerCase().replace(' repair', '')} problems — check these before you call, or call anytime and we'll handle it.</p>
  <div class="grid c3">${relFix.map((f) => `<div class="card"><span class="ic">${f.emoji}</span><h3>${enc(f.h1)}</h3><p>${enc(f.lede.slice(0, 110))}…</p><a class="more" href="fix/${f.slug}.html">Read the guide →</a></div>`).join('')}</div>
</div></section>` : ''}

<section><div class="wrap">
  <p class="eyebrow">All major appliances</p><h2>One local tech for the whole house</h2>
  <div class="grid c3">${APPLIANCES.filter((x) => x.slug !== a.slug).map((x) => `<div class="card"><span class="ic">${x.emoji}</span><h3>${enc(x.short)}</h3><p>${enc(x.symptoms.slice(0, 3).join(' · '))}</p><a class="more" href="${x.slug}.html">See ${enc(x.short.toLowerCase())} →</a></div>`).join('')}</div>
</div></section>

<section class="area"><div class="wrap">
  <p class="eyebrow">Where we work</p><h2>New Orleans &amp; all around</h2>
  <p>Based in New Orleans, covering the metro and the West Bank. Tap your area or call to confirm we reach you.</p>
  <div class="chips">${CITIES.slice(0, 14).map((c) => `<a href="${c.slug}.html">${enc(c.name)}</a>`).join('')}</div>
</div></section>

${faqSection(faq)}
${ctaBand(`${enc(a.short)} you can trust`, `Tell Andre what it's doing — he calls you right back with honest, upfront pricing.`)}`;
  return { file: `${a.slug}.html`, html: page({ title: `${a.name} in New Orleans | ${NAME}`, desc: `${a.lede} Call 4U — ${PHONE}. Same-day & next-day service across New Orleans & the West Bank.`, canon: `${a.slug}.html`, extraHead: schema + '\n' + faqSchema(faq), body }) };
}

function renderFix(f) {
  const ap = apById(f.appliance);
  const howto = jsonld({ '@context': 'https://schema.org', '@type': 'HowTo', name: f.title, description: f.lede, step: f.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s[0], text: s[1] })) });
  const body = `
<div class="hero"><div class="wrap">
  <p class="crumb"><a href="../">Home</a> › <a href="../${ap.slug}.html">${enc(ap.short)}</a> › Fix</p>
  <p class="kicker">${f.emoji} Troubleshooting guide</p>
  <h1>${enc(f.h1)}</h1>
  <p class="sub">${f.lede}</p>
  <div class="cta-row"><a class="btn" href="tel:${PHONE_TEL}">📞 Call ${PHONE}</a><a class="btn ghost" href="../${ap.slug}.html">${enc(ap.short)} →</a></div>
  <p class="promise">Rather not mess with it? Andre fixes it fast — call anytime.</p>
</div></div>

<section><div class="wrap">
  <p class="eyebrow">Most likely causes</p><h2>What's actually going on</h2>
  <ul class="causes">${f.causes.map((c) => `<li><b>${enc(c[0])}</b>${enc(c[1])}</li>`).join('')}</ul>
</div></section>

<section><div class="wrap">
  <p class="eyebrow">Check it yourself</p><h2>Safe steps before you call</h2>
  <p class="lead">Work through these in order — they're the same first checks a good technician makes.</p>
  <ul class="checklist">${f.steps.map((s) => `<li><b>${enc(s[0])}.</b> ${enc(s[1])}</li>`).join('')}</ul>
  <div class="pro"><p><b>When to call a pro:</b> ${enc(f.pro)}</p></div>
</div></section>

<section><div class="wrap">
  <p class="eyebrow">More ${enc(ap.short.toLowerCase().replace(' repair', ''))} help</p><h2>Related guides &amp; service</h2>
  <div class="grid c3">
    <div class="card"><span class="ic">${ap.emoji}</span><h3>${enc(ap.short)}</h3><p>Full ${enc(ap.short.toLowerCase())} service across the New Orleans metro.</p><a class="more" href="../${ap.slug}.html">See service →</a></div>
    ${FIXES.filter((x) => x.appliance === f.appliance && x.slug !== f.slug).slice(0, 2).map((x) => `<div class="card"><span class="ic">${x.emoji}</span><h3>${enc(x.h1)}</h3><p>${enc(x.lede.slice(0, 100))}…</p><a class="more" href="${x.slug}.html">Read guide →</a></div>`).join('')}
  </div>
</div></section>

${faqSection(f.faq)}
${ctaBand(`Still stuck? 4U's got you.`, `Andre diagnoses it right and quotes you upfront — no pressure, no mystery fees.`)}`;
  return { file: `fix/${f.slug}.html`, html: page({ base: '../', title: `${f.title} | ${NAME} · New Orleans`, desc: `${f.lede} ${NAME} — call ${PHONE} for fast, honest service in New Orleans & the West Bank.`, canon: `fix/${f.slug}.html`, extraHead: howto + '\n' + faqSchema(f.faq), body }) };
}

function renderCity(c) {
  const faq = [
    { q: `Do you repair appliances in ${c.name}?`, a: `Yes — ${c.name} (${c.parish}) is in 4U's service area. Call ${PHONE} and Andre will confirm your appointment and get a technician out fast.` },
    { q: `How fast can you get to ${c.name}?`, a: 'Most of the time same or next day. Call and we\'ll give you a real window — not a week-long wait.' },
    { q: 'What appliances do you fix?', a: 'Refrigerators, freezers, ice makers, washers, dryers, ovens, ranges, cooktops, dishwashers, disposals and microwaves — all major brands.' },
    { q: 'Do you charge to come out?', a: 'There\'s a service-call fee to diagnose it, and it goes toward your repair. Andre goes over the exact price before any work starts — no surprises.' },
  ];
  const schema = jsonld({ '@context': 'https://schema.org', '@type': 'ApplianceRepair', name: `${NAME_LEGAL} — ${c.name}`, telephone: PHONE_TEL, url: `${DOMAIN}/${c.slug}.html`, areaServed: { '@type': 'City', name: c.name, containedInPlace: { '@type': 'State', name: 'Louisiana' } }, address: { '@type': 'PostalAddress', addressLocality: c.name, addressRegion: 'LA', addressCountry: 'US' }, priceRange: '$$' });
  const body = `
<div class="hero"><div class="wrap">
  <p class="crumb"><a href="./">Home</a> › ${enc(c.name)}</p>
  <p class="kicker">🐜 ${enc(c.parish)}</p>
  <h1>Appliance Repair in <span class="o">${enc(c.name)}</span></h1>
  <p class="sub">${c.intro}</p>
  <div class="cta-row"><a class="btn" href="tel:${PHONE_TEL}">📞 Call ${PHONE}</a><a class="btn ghost" href="#svc">What we fix</a></div>
  <p class="promise">Local to the New Orleans area — Andre gets right back to you.</p>
</div></div>

<section id="svc"><div class="wrap">
  <p class="eyebrow">Serving ${enc(c.name)}</p><h2>Every major appliance, fixed right</h2>
  <p class="lead">4U covers ${c.areas.slice(0, -1).join(', ')} and ${c.areas.slice(-1)}${c.areas.length > 1 ? '' : ''} — refrigerators to dishwashers, all major brands.</p>
  <div class="grid c3">${APPLIANCES.map((x) => `<div class="card"><span class="ic">${x.emoji}</span><h3>${enc(x.short)}</h3><p>${enc(x.symptoms.slice(0, 3).join(' · '))}</p><a class="more" href="${x.slug}.html">See ${enc(x.short.toLowerCase())} →</a></div>`).join('')}</div>
</div></section>

<section><div class="wrap">
  <p class="eyebrow">Why ${enc(c.name)} calls 4U</p><h2>The way service should be</h2>
  <div class="grid c3">
    <div class="card"><span class="ic">⚡</span><h3>Fast to your door</h3><p>Same or next day across ${enc(c.name)} and the metro. You call, Andre gets right back with a time.</p></div>
    <div class="card"><span class="ic">💬</span><h3>Honest &amp; upfront</h3><p>You hear the exact price before we start — and whether it's even worth fixing.</p></div>
    <div class="card"><span class="ic">🐜</span><h3>Local &amp; family-run</h3><p>Named for Ant, run by family. We treat your ${enc(c.name)} home like our own.</p></div>
  </div>
</div></section>

<section><div class="wrap">
  <p class="eyebrow">Fix-it guides</p><h2>Troubleshoot before you call</h2>
  <div class="grid c3">${FIXES.slice(0, 6).map((f) => `<div class="card"><span class="ic">${f.emoji}</span><h3>${enc(f.h1)}</h3><p>${enc(f.lede.slice(0, 100))}…</p><a class="more" href="fix/${f.slug}.html">Read the guide →</a></div>`).join('')}</div>
</div></section>

<section class="area"><div class="wrap">
  <p class="eyebrow">Nearby areas</p><h2>All over the New Orleans area</h2>
  <div class="chips">${CITIES.filter((x) => x.slug !== c.slug).slice(0, 13).map((x) => `<a href="${x.slug}.html">${enc(x.name)}</a>`).join('')}</div>
</div></section>

${faqSection(faq)}
${ctaBand(`${enc(c.name)} appliance repair — done right`, `Tell Andre what's broken — he calls you right back with honest, upfront pricing.`)}`;
  return { file: `${c.slug}.html`, html: page({ title: `Appliance Repair in ${c.name}, LA | ${NAME}`, desc: `Fast, honest appliance repair in ${c.name} (${c.parish}). Fridge, washer, dryer, oven & dishwasher repair — all brands. Call 4U at ${PHONE}.`, canon: `${c.slug}.html`, extraHead: schema + '\n' + faqSchema(faq), body }) };
}

// =========================================================================
// WRITE
// =========================================================================
const outputs = [];
APPLIANCES.forEach((a) => outputs.push(renderAppliance(a)));
FIXES.forEach((f) => outputs.push(renderFix(f)));
CITIES.forEach((c) => outputs.push(renderCity(c)));

outputs.forEach((o) => {
  const p = path.join(ROOT, o.file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, o.html);
});

// sitemap
const today = process.env.BUILD_DATE || '2026-08-26';
const urls = ['', ...APPLIANCES.map((a) => a.slug + '.html'), ...FIXES.map((f) => 'fix/' + f.slug + '.html'), ...CITIES.map((c) => c.slug + '.html')];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${DOMAIN}/${u}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>${u === '' ? '1.0' : u.startsWith('fix/') ? '0.7' : '0.8'}</priority></url>`).join('\n')}
</urlset>`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);

// robots
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *
Allow: /

# AI answer engines welcome — this site is an appliance-repair authority for the New Orleans area
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /

Sitemap: ${DOMAIN}/sitemap.xml
`);

// llms.txt
fs.writeFileSync(path.join(ROOT, 'llms.txt'), `# ${NAME_LEGAL}

> Family-run appliance repair serving Greater New Orleans, Louisiana (also listed on Google as "${NAME_LEGAL}"). Refrigerators, washers, dryers, ovens, ranges, dishwashers, freezers and ice makers. Fast same/next-day service, honest upfront pricing. Named in honor of Anthony ("Ant"). Part of the TN Appliance Exchange family (technician-led, family-owned since 2012).

Owner-technician: Andre Pivacek. Phone: ${PHONE}. Service area: New Orleans (incl. New Orleans East), the West Bank (Gretna, Marrero, Harvey, Westwego, Algiers, Terrytown), Metairie, Kenner, Chalmette, LaPlace, the Baton Rouge area, plus the North Shore (Slidell, Mandeville, Covington) and Houma. Cash jobs. Pricing: $80 diagnostic, plus the part and roughly $100-$200 labor — quoted upfront before any work.

## Services
${APPLIANCES.map((a) => `- [${a.name}](${DOMAIN}/${a.slug}.html): ${a.lede}`).join('\n')}

## Troubleshooting guides (appliance symptoms)
${FIXES.map((f) => `- [${f.h1}](${DOMAIN}/fix/${f.slug}.html): ${f.lede.slice(0, 120)}`).join('\n')}

## Service areas
${CITIES.map((c) => `- [Appliance repair in ${c.name}, LA](${DOMAIN}/${c.slug}.html)`).join('\n')}

## Network
Part of TN Appliance Exchange — appliance repair across Louisiana & Middle Tennessee since 2012: https://tnapplianceexchange.net
`);

console.log(`Generated ${outputs.length} pages + sitemap.xml + robots.txt + llms.txt`);
console.log(`  ${APPLIANCES.length} appliance hubs, ${FIXES.length} /fix/ guides, ${CITIES.length} city pages`);
