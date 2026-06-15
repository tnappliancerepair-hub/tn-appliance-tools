#!/usr/bin/env node
/* generate-pages — Phase B aggressive long-tail SEO generator.
 * Produces unique, interlinked pages that all funnel into the contextual Appliance AI:
 *   - {brand}-{appliance}-repair-{town}.html   (e.g. samsung-refrigerator-repair-hammond)
 *   - {appliance}-repair-{town}.html            (e.g. refrigerator-repair-hammond)
 * Each page has real per-brand/appliance content (common failures), local framing,
 * hub-and-spoke interlinks, FAQ + LocalBusiness + Service JSON-LD, and the launcher.
 * Skips files that already exist. Writes sitemap.xml. DRY_RUN=1 to preview counts.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DRY = process.env.DRY_RUN === '1';
const SITE = 'https://tnapplianceexchange.net';

// ── which slices to generate (aggressive but real-demand) ──
const GEN_BRANDS = ['whirlpool','samsung','lg','ge','maytag','frigidaire','kenmore'];
const GEN_APPLIANCES = ['refrigerator','washer','dryer','dishwasher','oven'];

const BRAND_CAP = { whirlpool:'Whirlpool', samsung:'Samsung', lg:'LG', ge:'GE', maytag:'Maytag', frigidaire:'Frigidaire', kenmore:'Kenmore', electrolux:'Electrolux', bosch:'Bosch', amana:'Amana', kitchenaid:'KitchenAid' };
const BRAND_NOTE = {
  whirlpool:'Whirlpool units are everywhere and parts are widely available — most repairs are straightforward once the failed component is confirmed.',
  samsung:'Samsung is known for ice-maker and sealed-system quirks; pinpointing the exact part up front saves you a wasted service call.',
  lg:'LG’s linear-compressor and direct-drive designs need an accurate diagnosis — the right part the first time is the difference between a quick fix and weeks of waiting.',
  ge:'GE/Hotpoint units are common and well-documented; we usually know the likely culprit before we ever roll a truck.',
  maytag:'Maytag (Whirlpool family) shares many parts with Whirlpool, so sourcing is fast and repairs are clean.',
  frigidaire:'Frigidaire/Electrolux units have a handful of very common failure points — we see them constantly and price them honestly.',
  kenmore:'Kenmore is built by several manufacturers, so the model number is everything — that’s exactly what our Quick Check confirms.',
};
const APP = {
  refrigerator:{ label:'Refrigerator', problems:['Not cooling (fresh-food side warm)','Freezer works but fridge is warm','Ice maker not making ice','Water leaking on the floor','Running constantly / never shuts off','Loud, clicking, or buzzing noise'] },
  washer:{ label:'Washer', problems:['Won’t start','Won’t drain','Won’t spin','Leaking water','Loud or banging on the spin cycle','Lid/door won’t lock'] },
  dryer:{ label:'Dryer', problems:['No heat / clothes still wet','Takes two cycles to dry','Won’t start','Won’t tumble','Squealing or thumping','Shuts off early'] },
  dishwasher:{ label:'Dishwasher', problems:['Not cleaning dishes','Not draining','Won’t start','Leaking','Door latch broken','Not drying'] },
  oven:{ label:'Oven', problems:['Not heating','Won’t reach temperature','Won’t turn on','Bakes unevenly','Door won’t close / seal','Self-clean stuck'] },
};

const TOWNS_TN = ['antioch','brentwood','clarksville','franklin','gallatin','hendersonville','la-vergne','lebanon','murfreesboro','nashville','smyrna','spring-hill'];
const TOWNS_LA = ['baton-rouge','chalmette','covington','denham-springs','gonzales','hammond','kenner','laplace','madisonville','mandeville','metairie','new-orleans','pearl-river','ponchatoula','pumpkin-center','slidell','walker'];
const TC = (s)=>s.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
const TOWN = {};
[...TOWNS_TN,...TOWNS_LA].forEach(t=>{ const st = TOWNS_TN.includes(t)?'TN':'LA'; const peers=(st==='TN'?TOWNS_TN:TOWNS_LA).filter(x=>x!==t); TOWN[t]={slug:t,name:TC(t),st,neighbors:peers}; });

const allFiles = new Set(fs.readdirSync(ROOT).filter(f=>f.endsWith('.html')));
const planned = new Set();
const exists = (f)=> allFiles.has(f) || planned.has(f);

function chip(file,label){ if(!exists(file)&&!planned.has(file)) {} return `<a href="/${file}">${label}</a>`; }
function chipIf(file,label){ return (allFiles.has(file)||planned.has(file)) ? `<a href="/${file}">${label}</a>` : ''; }

function faqLd(what, where){
  const qa=[
    [`How much does ${what} repair cost${where}?`, `It starts with our $50 Quick Check — an honest, video-based diagnosis credited toward your repair. Most shops charge $125–150 just to show up.`],
    [`How fast can you help${where}?`, `Send a 10-second video and a photo of the model sticker through our appliance AI and you’ll get an honest assessment plus your repair options within 2 business hours.`],
    [`What if it’s not worth fixing?`, `We’ll tell you straight — including “don’t fix it.” You get a real answer either way, so you never sink money into a repair that doesn’t make sense.`],
  ];
  return { '@context':'https://schema.org','@type':'FAQPage', mainEntity: qa.map(([q,a])=>({'@type':'Question',name:q,acceptedAnswer:{'@type':'Answer',text:a}})) };
}
function bizLd(title, town){
  return { '@context':'https://schema.org','@type':['LocalBusiness','HomeAndConstructionBusiness'], name:'TN Appliance Exchange', url:SITE, telephone:'+1-866-268-0111',
    areaServed: town?town.name+', '+town.st:'Tennessee & Louisiana', description:title };
}

function render({ brand, appliance, town }){
  const A = APP[appliance];
  const bcap = brand?BRAND_CAP[brand]:'';
  const what = (bcap?bcap+' ':'') + A.label;
  const where = town ? (' in ' + town.name + ', ' + town.st) : '';
  const title = `${what} Repair${town?(' '+town.name+', '+town.st):''} | $50 Quick Check · TN Appliance Exchange`;
  const ctx = {}; if(brand)ctx.brand=bcap; ctx.appliance=appliance; if(town)ctx.town=town.name;
  const aiHref = '/appliance-ai.html?'+Object.entries(ctx).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
  const probs = A.problems.map(p=>`<li>${p}</li>`).join('');
  // interlinks
  const links = [];
  if(town){
    // same town, other appliances (this brand)
    GEN_APPLIANCES.forEach(a=>{ if(a!==appliance){ const f=(brand?`${brand}-${a}-repair-${town.slug}.html`:`${a}-repair-${town.slug}.html`); links.push(chipIf(f, `${bcap?bcap+' ':''}${APP[a].label} · ${town.name}`)); } });
    // same brand+appliance, nearby towns
    town.neighbors.slice(0,4).forEach(nt=>{ const f=(brand?`${brand}-${appliance}-repair-${nt}.html`:`${appliance}-repair-${nt}.html`); links.push(chipIf(f, `${what} · ${TC(nt)}`)); });
    // parents
    if(brand) links.push(chipIf(`${brand}-${appliance}-repair.html`, `${what} (all areas)`));
    links.push(chipIf(`${appliance}-repair.html`, `${A.label} Repair`));
    links.push(chipIf(`${town.slug}.html`, `${town.name} Appliance Repair`));
  }
  const linkHtml = links.filter(Boolean).slice(0,12).join('');

  const ld = [bizLd(title, town), faqLd(what.toLowerCase(), where), {'@context':'https://schema.org','@type':'Service',serviceType:`${what} Repair`,provider:{'@type':'LocalBusiness',name:'TN Appliance Exchange'},areaServed: town?town.name+', '+town.st:'TN & LA'}];

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${what} repair${where}. Get an honest, video-based diagnosis for $50 (credited to your repair) from our appliance AI — answer in hours. Tennessee & Louisiana.">
<link rel="canonical" href="${SITE}/${fileName({brand,appliance,town})}">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Geist+Mono:wght@400;500&family=Instrument+Serif&display=swap" rel="stylesheet">
<style>
:root{--black:#050505;--surface:#0c0c0c;--border:#1a1a1a;--bord2:#252525;--orange:#ff6200;--white:#f0f0f0;--gray:#888;--mono:'Geist Mono',monospace;--serif:'Instrument Serif',serif;--block:'Bebas Neue',sans-serif;}
*{box-sizing:border-box;margin:0;padding:0;}html,body{background:var(--black);color:var(--white);font-family:var(--mono);}
body{padding:22px 18px 90px;max-width:820px;margin:0 auto;line-height:1.55;}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px;}
.brand{font-family:var(--block);font-size:20px;letter-spacing:.06em;}.brand .d{color:var(--orange);}
.top a{color:var(--gray);text-decoration:none;font-size:12px;border:1px solid var(--bord2);padding:7px 12px;border-radius:8px;}
h1{font-family:var(--serif);font-size:33px;font-weight:400;line-height:1.12;margin-bottom:12px;}h1 .a{color:var(--orange);font-style:italic;}
.lede{color:var(--gray);font-size:15px;margin-bottom:22px;}
.cta{display:block;background:var(--orange);color:#000;text-decoration:none;text-align:center;font-weight:600;padding:16px;border-radius:13px;margin:8px 0 26px;font-size:16px;}
h2{font-family:var(--block);font-size:24px;letter-spacing:.04em;margin:26px 0 12px;}
ul{margin:0 0 8px 18px;}li{margin-bottom:6px;}
.val{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0;}
.val div{background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:12px;font-size:13px;color:var(--gray);}.val b{color:var(--white);font-weight:500;}
.rel{margin-top:30px;border-top:1px solid var(--border);padding-top:18px;}
.rel .k{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--orange);margin-bottom:10px;}
.rel a{display:inline-block;color:var(--orange);text-decoration:none;border:1px solid var(--bord2);border-radius:8px;padding:7px 12px;font-size:13px;margin:0 6px 6px 0;}
.foot{margin-top:36px;font-size:11px;color:#333;text-align:center;}.foot a{color:var(--gray);}
</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body>
<div class="top"><div class="brand">TN APPLIANCE<span class="d">.</span></div><a href="tel:+18662680111">📞 866-268-0111</a></div>
<h1>${what} Repair${town?(' in <span class="a">'+town.name+'</span>'):''}</h1>
<div class="lede">${what} acting up${where}? Skip the $125 trip charge and the guessing. Tell our appliance AI what's going on, send a 10-second video, and get an <b style="color:#f0f0f0">honest answer in hours</b> — for $50, credited to your repair.</div>
<a class="cta" href="${aiHref}">🐜 Start my $50 Quick Check →</a>

<h2>Common ${what} problems we see${where}</h2>
${brand?('<p style="color:#aaa;margin-bottom:10px">'+BRAND_NOTE[brand]+'</p>'):''}
<ul>${probs}</ul>

<h2>How the $50 Quick Check works</h2>
<div class="val">
  <div><b>1. Tell the AI</b> what your ${A.label.toLowerCase()} is doing.</div>
  <div><b>2. Send a 10-sec video</b> + a photo of the model sticker.</div>
  <div><b>3. Pay $50</b> — credited to your repair if you go ahead.</div>
  <div><b>4. Get the truth</b> + your options within 2 business hours.</div>
</div>
<p style="color:#888;font-size:13px">You choose: OEM or quality aftermarket part, and we install it or ship it to your door so you can. If it's not worth fixing, we'll tell you that too — no pressure, no $125 trip charge.</p>

<a class="cta" href="${aiHref}">🐜 Talk to the Appliance AI →</a>

${linkHtml?('<div class="rel"><div class="k">Related repairs &amp; nearby areas</div>'+linkHtml+'</div>'):''}

<div class="foot">TN Appliance Exchange LLC · Serving ${town?(town.name+' and nearby '+town.neighbors.slice(0,3).map(TC).join(', ')):'Tennessee & Louisiana'} · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></div>
<script>window.ANT_CTX=${JSON.stringify(ctx)};</script>
<script src="/ant-launcher.js" defer></script>
</body></html>`;
}
function fileName({brand,appliance,town}){ return (brand?`${brand}-${appliance}-repair`:`${appliance}-repair`) + (town?`-${town.slug}`:'') + '.html'; }

// ── plan the combos ──
const jobs = [];
Object.keys(TOWN).forEach(ts=>{ const town=TOWN[ts];
  GEN_APPLIANCES.forEach(appliance=>{
    const f0 = fileName({appliance,town}); if(!allFiles.has(f0)){ jobs.push({appliance,town,file:f0}); planned.add(f0); }
    GEN_BRANDS.forEach(brand=>{ const f = fileName({brand,appliance,town}); if(!allFiles.has(f)){ jobs.push({brand,appliance,town,file:f}); planned.add(f); } });
  });
});

console.log((DRY?'DRY-RUN — ':'')+`planned ${jobs.length} new pages (brands ${GEN_BRANDS.length} × appliances ${GEN_APPLIANCES.length} × towns ${Object.keys(TOWN).length} + appliance×town)`);
console.log('sample:', jobs.slice(0,6).map(j=>j.file).join(', '));

if(!DRY){
  let written=0;
  for(const j of jobs){ fs.writeFileSync(path.join(ROOT,j.file), render(j)); written++; }
  // sitemap of all marketing html
  const all=[...fs.readdirSync(ROOT).filter(f=>f.endsWith('.html'))];
  const urls=all.map(f=>`  <url><loc>${SITE}/${f}</loc></url>`).join('\n');
  fs.writeFileSync(path.join(ROOT,'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  console.log(`WROTE ${written} pages + sitemap.xml (${all.length} total urls)`);
}
