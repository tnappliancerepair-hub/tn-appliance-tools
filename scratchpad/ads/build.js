/* build.js — emit run-ready static ad cards (HTML) for AssistAnt (SaaS) + TN repair (consumer).
   Render step: drive headless Chrome --screenshot per file at its exact size (see render.sh).
   Brand: ink #0b0c10 / cream #f3ead6 / gold #e7c255 / emerald #4bbf8a / clay #d9694a;
   Fraunces (serif) + Archivo (sans) + Anton (heavy caps). ONLY-true copy — no invented stats.
   Layout: each card = 3 blocks (header / hero / footer) with space-between so nothing clips. */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = __dirname;

const ANT = `<svg class="antmark" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="translate(256 256)" fill="currentColor" stroke="currentColor"><path d="M-30 -130 Q-50 -170 -75 -180" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M30 -130 Q50 -170 75 -180" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="-75" cy="-180" r="7"/><circle cx="75" cy="-180" r="7"/><ellipse cx="0" cy="-100" rx="55" ry="50"/><circle cx="-22" cy="-110" r="6" fill="#0b0c10" stroke="none"/><circle cx="22" cy="-110" r="6" fill="#0b0c10" stroke="none"/><ellipse cx="0" cy="-15" rx="50" ry="55"/><ellipse cx="0" cy="100" rx="80" ry="70"/><g stroke-width="9" stroke-linecap="round" fill="none"><path d="M-45 -25 Q-100 -10 -130 -50"/><path d="M-45 0 Q-110 10 -140 0"/><path d="M-45 25 Q-110 30 -130 60"/><path d="M45 -25 Q100 -10 130 -50"/><path d="M45 0 Q110 10 140 0"/><path d="M45 25 Q110 30 130 60"/></g></g></svg>`;

const CSS = `
@font-face{font-family:Fraunces;src:url(fonts/fraunces.woff2) format('woff2');font-weight:100 900;font-display:block}
@font-face{font-family:Archivo;src:url(fonts/archivo.woff2) format('woff2');font-weight:400 900;font-display:block}
@font-face{font-family:Anton;src:url(fonts/anton.woff2) format('woff2');font-weight:400;font-display:block}
:root{--ink:#0b0c10;--cream:#f3ead6;--gold:#e7c255;--emerald:#4bbf8a;--clay:#d9694a;--muted:rgba(243,234,214,.62);--dim:rgba(243,234,214,.36);--line:rgba(231,194,85,.20)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{margin:0;padding:0;background:#0b0c10}
.card{position:relative;overflow:hidden;color:var(--cream);background:radial-gradient(130% 115% at 22% 4%,#1c1305 0%,#0d0a06 46%,var(--ink) 100%);font-family:Archivo,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.sq{width:1080px;height:1080px}.story{width:1080px;height:1920px}.link{width:1200px;height:630px}
.pad{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between}
.p84{padding:84px}.p72{padding:64px 72px}
.serif{font-family:Fraunces,'Playfair Display',Georgia,serif}
.anton{font-family:Anton,Impact,sans-serif;text-transform:uppercase;letter-spacing:.006em;line-height:.92}
.gold{color:var(--gold)}.em{color:var(--emerald)}.clay{color:var(--clay)}.muted{color:var(--muted)}.dim{color:var(--dim)}
.eyebrow{font-weight:800;letter-spacing:.28em;text-transform:uppercase;font-size:23px;color:var(--gold)}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:15px}
.antmark{width:52px;height:52px;color:var(--gold);flex:none}
.wm{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:32px}.wm b{color:var(--gold);font-weight:900}
.cta{display:flex;align-items:center;gap:18px;border-top:2px solid var(--line);padding-top:30px;margin-top:26px}
.url{font-family:Archivo;font-weight:800;font-size:33px}
.chip{display:inline-flex;align-items:center;gap:13px;background:rgba(243,234,214,.05);border:1.5px solid rgba(243,234,214,.13);border-radius:15px;padding:16px 22px;font-weight:600;font-size:29px;color:var(--dim)}
.chip s{text-decoration-color:var(--clay);text-decoration-thickness:3px}
.chip .x{color:var(--clay);font-weight:900}
.chips{display:flex;flex-wrap:wrap;gap:14px;max-width:840px}
.photo{position:absolute;inset:0;background-size:cover;background-position:center}
.scrim{position:absolute;inset:0}
.badge{display:inline-flex;align-items:center;gap:12px;border:2px solid var(--gold);color:var(--gold);border-radius:999px;padding:11px 24px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;font-size:23px}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.tile{border:2px solid var(--line);border-radius:20px;padding:26px 28px;background:rgba(231,194,85,.05)}
.tile h4{font-family:Archivo;font-weight:900;font-size:28px;color:var(--gold);letter-spacing:.01em;margin-bottom:7px}
.tile p{font-size:27px;color:var(--cream);line-height:1.26}
.stars{color:var(--gold);letter-spacing:.1em;font-size:29px}
`;

function page(kind, cls, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="card ${cls}"><div class="pad ${kind === 'link' ? 'p72' : 'p84'}">${body}</div></div></body></html>`;
}
function topbar(right) {
  return `<div class="topbar"><div class="brand">${ANT}<div class="wm">Assist<b>Ant</b></div></div><div class="eyebrow">${right}</div></div>`;
}

const CARDS = [];

// 1) THE BOULDERS — SaaS, beats "too many tools"
CARDS.push({ id: 'boulders', size: 'sq', html: page('sq', 'sq', `
  ${topbar('For appliance shops')}
  <div>
    <div class="serif" style="font-size:66px;line-height:1.04;font-weight:600">Drowning in <span class="gold">five<br>subscriptions</span>—and still<br>missing calls?</div>
    <div class="chips" style="margin-top:30px">
      <div class="chip"><span class="x">✕</span> Housecall Pro <s>per seat</s></div>
      <div class="chip"><span class="x">✕</span> Jobber <s>per seat</s></div>
      <div class="chip"><span class="x">✕</span> Workiz <s>per seat</s></div>
      <div class="chip"><span class="x">✕</span> Podium <s>just a bot</s></div>
    </div>
  </div>
  <div>
    <div class="anton gold" style="font-size:92px">One system.<br>$100 flat.</div>
    <div class="muted" style="font-size:31px;margin-top:16px;line-height:1.3">Answers every call 24/7 · books the job · every tech included.</div>
    <div class="cta"><div class="url gold">tnapplianceexchange.net/ant</div></div>
  </div>
`) });

// 2) THEY TAKE A MESSAGE. WE BOOK THE JOB. — SaaS, beats a phone bot
CARDS.push({ id: 'message-vs-job', size: 'sq', html: page('sq', 'sq', `
  ${topbar('AI receptionist')}
  <div class="anton" style="font-size:80px"><span class="clay">They take a<br>message.</span><br><span class="gold">We book<br>the job.</span></div>
  <div>
    <div class="tiles">
      <div class="tile" style="border-color:rgba(217,105,74,.42)"><h4 class="clay">A phone bot</h4><p class="muted">“Leave your name and number.” You call them back tomorrow. Maybe.</p></div>
      <div class="tile" style="border-color:var(--gold)"><h4>Ann, on AssistAnt</h4><p>Knows who's calling. Books the day, flags the part, texts the customer — 24/7.</p></div>
    </div>
    <div class="cta"><div class="url"><span class="muted">$100/mo flat · hear her live</span> <span class="gold">(615) 588-9400</span></div></div>
  </div>
`) });

// 3) BROKEN AT 2AM? WE ANSWER. — consumer repair, story, real truck photo
CARDS.push({ id: 'broken-2am', size: 'story', html: page('story', 'story', `
  <div class="photo" style="background-image:url('../../assets/marketing/truck-sky.jpg');opacity:.55"></div>
  <div class="scrim" style="background:linear-gradient(180deg,rgba(11,12,16,.5) 0%,rgba(11,12,16,.12) 32%,rgba(11,12,16,.85) 72%,var(--ink) 100%)"></div>
  <div class="pad p84" style="z-index:2">
    ${topbar('TN Appliance · 24/7')}
    <div>
      <div class="badge">🕑 2:14 AM · Sunday</div>
      <div class="serif gold" style="font-size:150px;line-height:.95;font-weight:700;margin-top:34px">Broken<br>at 2am?</div>
      <div class="anton" style="font-size:158px;margin-top:8px">We answer.</div>
      <div style="font-size:44px;line-height:1.32;margin-top:42px;max-width:900px">Fridge died on a Sunday? Dryer quit at midnight? A <span class="gold">real tech</span> gives you an honest answer — call, text, or send a quick video.</div>
    </div>
    <div>
      <div class="stars">★★★★½ &nbsp;<span class="muted" style="font-size:30px;letter-spacing:0">4.5 across 1,000+ neighbors</span></div>
      <div class="cta" style="border-top-color:rgba(231,194,85,.4)"><div class="url">Same-day repair · honest flat pricing</div></div>
      <div class="url gold" style="margin-top:20px;font-size:42px">tnapplianceexchange.net</div>
    </div>
  </div>
`) });

// 4) THE HONEST 4 OPTIONS — consumer, the 2x2 matrix
CARDS.push({ id: 'honest-4-options', size: 'sq', html: page('sq', 'sq', `
  ${topbar('Honest pricing')}
  <div class="serif" style="font-size:62px;line-height:1.05;font-weight:600">Other shops tell you what<br>to pay. <span class="gold">We give you four<br>honest options.</span></div>
  <div>
    <div class="tiles">
      <div class="tile"><h4>OEM part · we install</h4><p class="muted">Factory part, fixed by our tech.</p></div>
      <div class="tile"><h4>Aftermarket · we install</h4><p class="muted">Quality equivalent, installed.</p></div>
      <div class="tile"><h4>OEM · shipped to you</h4><p class="muted">DIY it — delivered to your door.</p></div>
      <div class="tile"><h4>Aftermarket · you install</h4><p class="muted">Cheapest path, your call.</p></div>
    </div>
    <div class="anton gold" style="font-size:66px;margin-top:34px">You pick. We don't gouge.</div>
    <div class="cta"><div class="url gold">tnapplianceexchange.net</div></div>
  </div>
`) });

// 5) COPYCATS CAN'T CLONE THIS — SaaS free-guide (fear -> free playbook -> /guide)
CARDS.push({ id: 'copycats-guide', size: 'sq', html: page('sq', 'sq', `
  ${topbar('Free playbook')}
  <div>
    <div class="anton" style="font-size:96px"><span class="clay">Anyone can<br>clone a screen.</span></div>
    <div class="serif" style="font-size:60px;line-height:1.06;font-weight:600;margin-top:26px">They can't clone what a real<br>appliance shop <span class="gold">knows.</span></div>
  </div>
  <div>
    <div class="tile" style="border-color:var(--gold);background:rgba(231,194,85,.07)"><h4>FREE · The 24/7 Answering &amp; Triage Playbook</h4><p class="muted" style="margin-top:4px">The exact call script + booking rules a real shop runs on — so anyone in your office books real jobs. No strings.</p></div>
    <div class="cta"><div class="url gold">Get it → tnapplianceexchange.net/guide</div></div>
  </div>
`) });

const manifest = [];
for (const c of CARDS) {
  fs.writeFileSync(path.join(DIR, c.id + '.html'), c.html);
  manifest.push({ id: c.id, size: c.size });
}
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('wrote ' + manifest.length + ' cards: ' + manifest.map(m => m.id + '(' + m.size + ')').join(', '));
