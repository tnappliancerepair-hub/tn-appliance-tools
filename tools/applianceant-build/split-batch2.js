'use strict';
// Aggressive two-site split — batch 2: South Shore LA + TN metro.
// 1) no-index every thin {*}-repair-{city}.html lander for the target cities
// 2) add a DIY-crosslink block to each strong {city}.html hub (stays indexed)
// 3) drop the newly no-indexed landers from the repair-site sitemap.xml
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const CITIES = [
  // South Shore LA (Andre / New Orleans metro)
  'new-orleans','metairie','kenner','chalmette','laplace','pumpkin-center',
  // TN metro (Nashville / home base)
  'nashville','murfreesboro','smyrna','la-vergne','antioch','hermitage','mt-juliet',
  'clarksville','franklin','hendersonville','gallatin','lebanon','spring-hill','brentwood',
];

// city slug -> display name
const SPECIAL = { 'mt-juliet':'Mt. Juliet', 'la-vergne':'La Vergne', 'new-orleans':'New Orleans', 'laplace':'LaPlace' };
function disp(slug){
  if (SPECIAL[slug]) return SPECIAL[slug];
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const ROBOTS = '<meta name="robots" content="noindex, follow">';
let noindexed = 0, hubsLinked = 0;
const removedLanders = new Set();

// ── 1) no-index thin landers ────────────────────────────────────────────────
for (const city of CITIES) {
  const landers = fs.readdirSync(ROOT).filter(f =>
    f.endsWith('-repair-' + city + '.html') && f !== city + '.html'
  );
  for (const f of landers) {
    const p = path.join(ROOT, f);
    let html = fs.readFileSync(p, 'utf8');
    if (/name="robots"\s+content="noindex/.test(html)) { removedLanders.add(f); continue; } // already done
    if (!/<\/title>/i.test(html)) { console.log('  ! no </title> in', f); continue; }
    html = html.replace(/<\/title>/i, '</title>\n' + ROBOTS);
    fs.writeFileSync(p, html);
    noindexed++; removedLanders.add(f);
  }
}

// ── 2) DIY-crosslink block on each city hub ─────────────────────────────────
function diyBlock(cityName){
  return `
<!-- DIY-CROSSLINK: repair hub -> Appliance Ant DIY site -->
<div style="max-width:880px;margin:0 auto 8px;padding:0 32px">
  <div style="background:linear-gradient(135deg,rgba(255,98,0,.08),rgba(255,98,0,.02));border:1px solid rgba(255,98,0,.28);border-radius:16px;padding:26px 26px">
    <div style="font-family:var(--block);font-size:23px;letter-spacing:.03em;color:var(--white);margin-bottom:8px">🛠️ Rather try it yourself first?</div>
    <div style="font-size:13.5px;color:var(--gray);line-height:1.75;margin-bottom:16px">No problem — we'll show you. Our DIY site <b style="color:var(--white)">Appliance Ant</b> has honest, step-by-step guides for the most common ${cityName} breakdowns: the real cause, the exact part, and a straight answer on when it's worth calling us instead.</div>
    <div style="display:flex;flex-wrap:wrap;gap:9px">
      <a href="https://applianceant.com/dryer-not-heating" style="font-size:12.5px;color:var(--white);text-decoration:none;border:1px solid var(--bord2);border-radius:999px;padding:8px 14px;transition:all .2s">Dryer not heating →</a>
      <a href="https://applianceant.com/refrigerator-not-cooling" style="font-size:12.5px;color:var(--white);text-decoration:none;border:1px solid var(--bord2);border-radius:999px;padding:8px 14px">Fridge not cooling →</a>
      <a href="https://applianceant.com/washer-not-draining" style="font-size:12.5px;color:var(--white);text-decoration:none;border:1px solid var(--bord2);border-radius:999px;padding:8px 14px">Washer not draining →</a>
      <a href="https://applianceant.com/dishwasher-not-draining" style="font-size:12.5px;color:var(--white);text-decoration:none;border:1px solid var(--bord2);border-radius:999px;padding:8px 14px">Dishwasher not draining →</a>
      <a href="https://applianceant.com" style="font-size:12.5px;color:var(--orange);text-decoration:none;border:1px solid rgba(255,98,0,.4);border-radius:999px;padding:8px 14px;font-weight:600">All DIY guides →</a>
    </div>
  </div>
</div>

`;
}
for (const city of CITIES) {
  const p = path.join(ROOT, city + '.html');
  if (!fs.existsSync(p)) { console.log('  ! no hub', city + '.html'); continue; }
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes('DIY-CROSSLINK')) continue; // idempotent
  const anchor = '<div class="cta-section">';
  const i = html.indexOf(anchor);
  if (i < 0) { console.log('  ! no cta-section anchor in', city + '.html'); continue; }
  html = html.slice(0, i) + diyBlock(disp(city)) + html.slice(i);
  fs.writeFileSync(p, html);
  hubsLinked++;
}

// ── 3) prune sitemap.xml ─────────────────────────────────────────────────────
const smPath = path.join(ROOT, 'sitemap.xml');
let sm = fs.readFileSync(smPath, 'utf8');
const before = (sm.match(/<loc>/g) || []).length;
// Split into <url>...</url> blocks, keep only those whose loc filename isn't a removed lander.
sm = sm.replace(/[ \t]*<url>[\s\S]*?<\/url>\n?/g, (block) => {
  const m = block.match(/<loc>[^<]*\/([^\/<]+\.html)<\/loc>/);
  if (m && removedLanders.has(m[1])) return '';
  return block;
});
const after = (sm.match(/<loc>/g) || []).length;
fs.writeFileSync(smPath, sm);

console.log('no-indexed landers this run:', noindexed);
console.log('hubs given DIY crosslink   :', hubsLinked);
console.log('sitemap <loc> before/after :', before, '->', after, '(removed ' + (before - after) + ')');
