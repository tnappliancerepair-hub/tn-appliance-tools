// build-tn-vent-hubs.js — fresh, UNIQUE dryer-vent-cleaning landers for the
// Middle Tennessee markets + a Middle TN regional hub. Mirrors the LA cluster.
// Each city page carries genuinely local content (housing stock, county, the
// new-construction / long-roof-run factor, the serving tech) so it's not a thin
// doorway lander. Nashville is intentionally left to the master page
// (dryer-vent-cleaning.html) to avoid self-competition. Funnels to /book-repair.
//
// Idempotent: overwrites its own output files each run.
//   node tools/seo-build/build-tn-vent-hubs.js
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const SITE = 'https://tnapplianceexchange.net';
const exists = (slug) => fs.existsSync(path.join(REPO, slug + '.html'));

// Per-city UNIQUE content. factor = a real local reason vents matter here.
const CITIES = [
  { slug: 'murfreesboro', name: 'Murfreesboro', st: 'TN', county: 'Rutherford County', region: 'Rutherford County', tech: 'Jimmy',
    factor: "Murfreesboro is one of the fastest-growing cities in Tennessee, and it's wall-to-wall newer two-story subdivisions — Blackman, Gateway, Salem and out toward Barfield. Those homes run the dryer exhaust a long way up and out the roof, and a brand-new house that's never had the vent cleaned since it was built is exactly where lint quietly packs in.",
    hoods: 'Blackman, Gateway, Salem, Barfield and the subdivisions off Veterans Parkway' },
  { slug: 'smyrna', name: 'Smyrna', st: 'TN', county: 'Rutherford County', region: 'Rutherford County', tech: 'Jimmy',
    factor: "Smyrna mixes established ranch homes near the old town with newer two-story builds around the Nissan plant and Lake Forest. Whether it's a short side-wall run or a long roof run, years of use without a cleaning is what turns a good dryer into one that takes two cycles.",
    hoods: 'Lake Forest, Almaville, downtown Smyrna and the subdivisions off Sam Ridley' },
  { slug: 'la-vergne', name: 'La Vergne', st: 'TN', county: 'Rutherford County', region: 'Rutherford County', tech: 'Jimmy',
    factor: "La Vergne's newer construction along the I-24 corridor tends to put the laundry room well inside the house with a long slab-level duct to the outside wall. The longer that run, the more lint it traps before it ever reaches daylight.",
    hoods: 'Lake Forest Estates, the I-24 subdivisions and downtown La Vergne' },
  { slug: 'franklin', name: 'Franklin', st: 'TN', county: 'Williamson County', region: 'Williamson County', tech: 'Jimmy',
    factor: "Franklin runs from historic homes downtown to large upscale subdivisions like Westhaven and the Cool Springs area. The bigger two-story homes route the dryer a long way up through the roof — long runs that clog faster than most homeowners ever realize.",
    hoods: 'downtown Franklin, Westhaven, Cool Springs, Fieldstone Farms and McKay’s Mill' },
  { slug: 'brentwood', name: 'Brentwood', st: 'TN', county: 'Williamson County', region: 'Williamson County', tech: 'Jimmy',
    factor: "Brentwood is estate country — large multi-story homes on big lots, and some of the longest dryer-vent runs in Middle Tennessee, most exiting through the roof. Long roof-exit runs are exactly where lint packs in and exactly the runs most vent crews would rather not climb. We do.",
    hoods: 'Governors Club, Annandale, Raintree Forest and the estates off Concord and Wilson Pike' },
  { slug: 'spring-hill', name: 'Spring Hill', st: 'TN', county: 'Williamson & Maury Counties', region: 'Williamson County', tech: 'Jimmy',
    factor: "Spring Hill has been booming with new construction around the GM plant, and it's two-story subdivisions as far as you can see. Brand-new homes with long roof runs that have never once been cleaned are already starting to clog — the vent problem nobody expects in a five-year-old house.",
    hoods: 'Wades Grove, Campbell Station, the Crossings and the subdivisions off Buckner and Port Royal' },
  { slug: 'antioch', name: 'Antioch', st: 'TN', county: 'Davidson County', region: 'Nashville & East Davidson', tech: 'Teddy',
    factor: "Antioch is our home base, and it's a dense mix of established homes, newer builds and townhomes off Bell Road, Cane Ridge and Hickory Hollow. Townhomes especially run long or shared vent paths, and older homes here often haven't had the vent touched in years.",
    hoods: 'Cane Ridge, Hickory Hollow, Bell Road and the townhome communities off Blue Hole' },
  { slug: 'mt-juliet', name: 'Mt. Juliet', st: 'TN', county: 'Wilson County', region: 'Wilson & Sumner Counties', tech: 'Teddy',
    factor: "Mt. Juliet is one of the fastest-growing spots in the state, packed with new subdivisions off I-40 and around Providence. Those new two-story homes vent up and out a long way — a fresh build with a lint problem waiting to happen if the run's never been cleared.",
    hoods: 'Providence, Willoughby Station, Nichols Vale and the subdivisions off Central Pike' },
  { slug: 'lebanon', name: 'Lebanon', st: 'TN', county: 'Wilson County', region: 'Wilson & Sumner Counties', tech: 'Teddy',
    factor: "Lebanon blends an older downtown with fast-growing Wilson County subdivisions. Between the long runs on the newer two-story homes and years of buildup in the established ones, a clogged vent is the usual reason a Lebanon dryer suddenly can't keep up.",
    hoods: 'downtown Lebanon, the Hunters Point area and the subdivisions off Highway 109' },
  { slug: 'hendersonville', name: 'Hendersonville', st: 'TN', county: 'Sumner County', region: 'Wilson & Sumner Counties', tech: 'Teddy',
    factor: "Hendersonville wraps around Old Hickory Lake, mixing established lakeside homes with newer subdivisions. The humidity off the lake makes damp lint cake the duct faster, and the longer roof runs on the two-story homes are where it collects.",
    hoods: 'the Old Hickory Lake area, Indian Lake, Walton Ferry and the subdivisions off Saundersville' },
  { slug: 'gallatin', name: 'Gallatin', st: 'TN', county: 'Sumner County', region: 'Wilson & Sumner Counties', tech: 'Teddy',
    factor: "Gallatin is growing fast on the north side of Old Hickory Lake, with new subdivisions going up alongside its older established neighborhoods. New or old, a long dryer-vent run that's never been cleaned is the quiet reason drying starts taking two and three cycles.",
    hoods: 'Fairvue Plantation, Foxland Harbor, downtown Gallatin and the subdivisions off Highway 109' },
  { slug: 'clarksville', name: 'Clarksville', st: 'TN', county: 'Montgomery County', region: 'Clarksville area', tech: 'Lee',
    factor: "Clarksville is a Fort Campbell town with heavy rental turnover — homes cycle tenants constantly, and the dryer vent is the one thing that almost never gets cleaned between them. Add the fast new construction on the north and east sides, and you've got a lot of long runs full of lint nobody's touched.",
    hoods: 'Sango, Rossview, St. Bethlehem, the Fort Campbell area and the north-side subdivisions' },
];

const css = `*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;margin:0;padding:0}
html,body{background:#f6f8fb;min-height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a202c;line-height:1.5;padding:20px 16px 60px;max-width:600px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.brand .logo{font-size:30px}.brand .name{font-size:15px;font-weight:800;letter-spacing:.02em;color:#ff8a00}
h1{font-size:26px;margin-bottom:6px;line-height:1.15}
.king{background:linear-gradient(135deg,#ff8a00,#e26d00);color:#fff;border-radius:13px;padding:12px 15px;font-size:15px;font-weight:800;line-height:1.3;margin:2px 0 12px}
.king .sub{display:block;font-size:12.5px;font-weight:600;opacity:.95;margin-top:3px}
.cred{display:inline-flex;align-items:center;gap:8px;background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:700;margin-bottom:16px}
.cred .seal{font-size:16px}
.lede{color:#4a5568;font-size:15px;margin-bottom:16px}.lede b{color:#1a202c}
.local{background:#eef4ff;border:1px solid #bcd2ff;border-radius:13px;padding:15px 17px;margin-bottom:18px;font-size:14px;color:#22406e;line-height:1.6}
.local b{color:#12203a}
.pmatch{background:#052e16;border:2px solid #16a34a;border-radius:14px;padding:16px 18px;margin-bottom:18px}
.pmatch .pm-badge{display:inline-block;background:#16a34a;color:#052e16;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:4px 11px;border-radius:999px;margin-bottom:9px}
.pmatch .pm-h{font-size:19px;font-weight:800;color:#fff;margin-bottom:6px;line-height:1.2}
.pmatch p{font-size:14px;color:#bbf7d0;line-height:1.55}.pmatch b{color:#fff}
.pmatch .pm-fine{font-size:11.5px;color:#8fbf99;margin-top:11px;line-height:1.5}.pmatch .pm-fine b{color:#dcfce7;font-weight:600}
.edge{background:#fff;border:2px solid #ff8a00;border-radius:14px;padding:16px;margin-bottom:20px}
.edge .eh{font-size:15px;font-weight:800;color:#1a202c;margin-bottom:6px}.edge p{font-size:14px;color:#4a5568}.edge b{color:#ad4e00}
.signs{background:#fff7e6;border:1px solid #ffd591;border-radius:13px;padding:14px 16px;margin-bottom:20px}
.signs .sh{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#ad4e00;margin-bottom:8px}
.signs ul{list-style:none;display:flex;flex-direction:column;gap:6px}.signs li{font-size:14px;color:#5a4321;padding-left:24px;position:relative}.signs li:before{content:"⚠️";position:absolute;left:0;top:0}
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05)}
label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#4a5568;margin:14px 0 6px}label .req{color:#c53030}
input,textarea{width:100%;padding:13px 14px;border:2px solid #e2e8f0;border-radius:11px;font-size:16px;font-family:inherit;background:#fff;color:#1a202c}
input:focus,textarea:focus{outline:none;border-color:#ff8a00}textarea{min-height:74px;resize:vertical}
.addr-row{display:flex;gap:8px}.addr-row .city{flex:2}.addr-row .state{flex:0 0 64px}.addr-row .zip{flex:0 0 92px}
.hint{font-size:12px;color:#718096;margin-top:4px}
.btn{width:100%;margin-top:20px;padding:16px;border:0;border-radius:13px;background:linear-gradient(135deg,#ff8a00,#e26d00);color:#fff;font-size:17px;font-weight:800;cursor:pointer;font-family:inherit}.btn:disabled{opacity:.55}
.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#c53030;padding:11px 14px;border-radius:10px;font-size:14px;margin-top:12px;display:none}.err.show{display:block}
.trust{text-align:center;color:#718096;font-size:13px;margin-top:14px}.trust a{color:#ad4e00;font-weight:700;text-decoration:none}
.rel{margin-top:22px;padding-top:16px;border-top:1px solid #e6eaf0;font-size:12.5px;color:#8a93a5;line-height:2}.rel b{color:#5a6678}.rel a{color:#ad4e00;text-decoration:none}
.done{display:none;text-align:center;padding:30px 16px}.done .ico{font-size:60px}.done h2{font-size:24px;margin:8px 0 6px}.done p{color:#4a5568;font-size:16px;line-height:1.5}`;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

function pageHtml(c, others) {
  const rel = others.filter((o) => o.slug !== c.slug).slice(0, 6)
    .map((o) => `<a href="/dryer-vent-cleaning-${o.slug}.html">${o.name}</a>`).join(' · ');
  const dryerLink = exists('dryer-repair-' + c.slug)
    ? `<br><b style="display:inline-block;margin-top:8px">Dryer acting up?</b> <a href="/dryer-repair-${c.slug}.html">${c.name} dryer repair &rarr;</a>` : '';
  const faq = [
    { q: `Do you clean dryer vents in ${c.name}?`, a: `Yes — dryer vent cleaning in ${c.name} and across ${c.county} is exactly what we do. We're CSIA Certified Dryer Exhaust Technicians (C-DET), we price-match any licensed competitor, and we can often get you cleaned out the same day.` },
    { q: `Can you clean my ${c.name} dryer vent today?`, a: `Often yes. Text or call and we'll get right back to you with the soonest opening — usually same-day in ${c.name} and across Middle Tennessee.` },
    { q: `Do you clean roof and two-story vents?`, a: `Yes. Long two- and three-story runs and roof-exit vents are common in ${c.name}, and we handle the ones most crews skip — plus the vent hose, transition duct and the exterior wall hood.` },
    { q: `Do you clean the dryer itself, not just the vent?`, a: `We can — it's an optional add-on. Because we're certified appliance repair techs, we open the dryer and clear the lint trapped inside the machine, where a lot of the fire hazard hides. No vent-only crew in ${c.name} does that.` },
    { q: `Do you handle apartment complexes in ${c.name}?`, a: `Yes — a single home or every unit in a ${c.name} complex, one price-matched quote for the whole property, including reroutes and exterior wall vent hood replacement.` },
  ];
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const svcLd = {
    '@context': 'https://schema.org', '@type': 'Service', serviceType: 'Dryer vent cleaning',
    provider: {
      '@type': 'LocalBusiness', name: 'TN Appliance Exchange', telephone: '+1-615-280-2949', url: SITE + '/',
      knowsAbout: ['Dryer vent cleaning', 'Dryer exhaust systems', 'Dryer fire prevention'],
      hasCredential: { '@type': 'EducationalOccupationalCredential', credentialCategory: 'certification', name: 'C-DET — Certified Dryer Exhaust Technician', recognizedBy: { '@type': 'Organization', name: 'Chimney Safety Institute of America (CSIA)', url: 'https://www.csia.org/' } },
    },
    areaServed: { '@type': 'City', name: `${c.name}, ${c.st}` },
    description: `Same-day dryer vent cleaning in ${c.name}, ${c.st} (${c.county}). CSIA C-DET certified, price-match guaranteed, single home to whole apartment complex. We also break down and clean the dryer itself — no other vent crew does. Reroutes, roof and two-story runs, vent hose, disconnects and exterior wall hood replacement.`,
  };
  const bread = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: 'Dryer Vent Cleaning', item: SITE + '/dryer-vent-cleaning.html' },
    { '@type': 'ListItem', position: 3, name: 'Middle Tennessee', item: SITE + '/dryer-vent-cleaning-tennessee.html' },
    { '@type': 'ListItem', position: 4, name: `${c.name} ${c.st}`, item: `${SITE}/dryer-vent-cleaning-${c.slug}.html` },
  ] };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Dryer Vent Cleaning ${c.name}, ${c.st} — Same-Day, Price-Match</title>
<meta name="description" content="${esc(`Same-day dryer vent cleaning in ${c.name}, ${c.st}. CSIA C-DET certified, price-match guaranteed. We're the only crew that also breaks down and cleans the dryer itself. Roof, two-story, apartment complexes. Text back in minutes.`)}">
<link rel="canonical" href="${SITE}/dryer-vent-cleaning-${c.slug}.html">
<meta property="og:title" content="Dryer Vent Cleaning ${c.name}, ${c.st} — Same-Day, Price-Match">
<meta property="og:description" content="${esc(`The dryer vent cleaning people for ${c.name} and Middle Tennessee. Same-day, price-match, CSIA-certified — and we clean the dryer itself, not just the vent.`)}">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta name="theme-color" content="#ff8a00">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-0EF3THNXLE"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-0EF3THNXLE');</script>
<style>${css}</style>
</head>
<body>
<div class="brand"><div class="logo">🐜</div><div class="name">TN APPLIANCE EXCHANGE</div></div>

<div id="form-wrap">
  <h1>Dryer vent cleaning in ${c.name}, ${c.st}</h1>
  <div class="king">👑 We are the dryer vent cleaning people.<span class="sub">${c.name}, ${c.county} &amp; all of Middle Tennessee — same-day when you need it.</span></div>
  <div class="cred"><span class="seal">⚡</span> Same-day service in ${c.name} — we can get it done today</div>
  <div class="cred"><span class="seal">🎖️</span> CSIA Certified Dryer Exhaust Technician (C-DET)</div>
  <div class="cred"><span class="seal">💵</span> $80 books a full inspection + up to 2 ft of vent cleaning (applies to your total)</div>

  <a href="/vent-intake.html?city=${encodeURIComponent(c.name)}&state=${c.st}" style="display:block;text-align:center;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;padding:15px;border-radius:13px;font-size:17px;font-weight:800;text-decoration:none;margin:8px 0 4px;box-shadow:0 6px 20px rgba(22,163,74,.3)">🔥 Book online in 1 minute — from $80 →</a>
  <div style="text-align:center;font-size:12.5px;color:#8a93a5;margin-bottom:14px">Tell us your setup, pick when you're free, $80 locks it in.</div>
  <div class="lede">Dryer in ${c.name} taking <b>2-3 cycles to dry?</b> That's a clogged vent — a fire risk that wastes energy and wears out your dryer. We clean it out fast, and if the vent's crushed, disconnected, or missing, we <b>install a new one</b>. <b>We'll text you right back</b> — and we can often get you cleaned out <b>the same day</b>.</div>

  <div class="local">
    <b>${c.name} homes, ${c.name} vents.</b> ${c.factor} We know the ${c.hoods} runs — and we clear the whole path, from the lint trap to the wall cap. ${c.tech} runs this area for us and gets it done right.
  </div>

  <div class="pmatch">
    <div class="pm-badge">💵 Price-Match Guarantee</div>
    <div class="pm-h">Got a lower quote in ${c.name}? We'll match it.</div>
    <p>Show us any local competitor's written price on a dryer exhaust cleaning and <b>we'll match it</b> — from a <b>single unit to an entire apartment complex</b>. And because we're certified appliance techs, we go where vent-only crews can't: <b>break down and clean the dryer itself</b>, clearing the lint <b>inside the machine</b> where the real fire hazard hides.</p>
    <p class="pm-fine">Just show us the written quote. We match <b>licensed, insured professionals</b> only, and the tech reserves the right to decline any match.</p>
  </div>

  <div class="edge">
    <div class="eh">🔧 We're appliance techs — nobody else does this</div>
    <p><b>No other vent-cleaning company in ${c.name} breaks down and cleans the dryer itself</b> — they can't, it's a liability for them. We're certified appliance repair techs, so we pop the dryer open and clear the lint trapped <b>inside the machine</b>, not just the vent line. Ask about the full dryer + vent deep-clean <b>add-on</b> when we come out.</p>
  </div>

  <div class="edge">
    <div class="eh">🏢 Ranch, two-story, three-story or a whole complex</div>
    <p>We clean <b>a single home</b>, a <b>two- or three-story</b> house with a long roof run, or <b>every unit in an apartment complex</b> in ${c.name} — one price-matched quote for the whole property. We handle the <b>roof-exit and side-wall vents</b> most crews skip, the <b>vent hose and transition duct</b> behind the dryer, <b>disconnects</b>, full <b>reroutes</b>, and we replace the <b>exterior wall vent hood</b> so lint and pests stay out.</p>
  </div>

  <div class="signs">
    <div class="sh">Signs your ${c.name} vent needs cleaning</div>
    <ul>
      <li>Clothes still damp after a full cycle</li>
      <li>Dryer + laundry room hot to the touch</li>
      <li>Burning / musty smell when running</li>
      <li>It's been over a year (or never)</li>
    </ul>
  </div>

  <div class="card">
    <label for="name">Your name <span class="req">*</span></label>
    <input id="name" type="text" placeholder="First Last" autocomplete="name">
    <label for="phone">Mobile number <span class="req">*</span></label>
    <input id="phone" type="tel" placeholder="(615) 555-0199" autocomplete="tel" inputmode="tel">
    <div class="hint">We'll text you here in a few minutes to set up your visit.</div>
    <label for="problem">Anything we should know? <span style="text-transform:none;font-weight:600;color:#a0aec0">(optional)</span></label>
    <textarea id="problem" placeholder="e.g. Vent exits through the roof / takes 2 cycles to dry / never been cleaned"></textarea>
    <label>Where in ${c.name}? <span style="text-transform:none;font-weight:600;color:#a0aec0">(optional)</span></label>
    <input id="address" type="text" placeholder="Street address" autocomplete="street-address">
    <div class="addr-row" style="margin-top:8px">
      <input class="city" id="city" type="text" value="${c.name}" autocomplete="address-level2">
      <input class="state" id="state" type="text" value="${c.st}" maxlength="2" autocomplete="address-level1">
      <input class="zip" id="zip" type="text" placeholder="ZIP" maxlength="5" inputmode="numeric" autocomplete="postal-code">
    </div>
    <button class="btn" id="submit">Book my ${c.name} vent cleaning (price-match) →</button>
    <div class="err" id="err"></div>
  </div>
  <div class="trust">Prefer to talk? Call or text <a href="tel:+16152802949">615-280-2949</a> — a real person answers.</div>

  <div class="rel">
    <b>Dryer vent cleaning across Middle Tennessee:</b><br>
    ${rel} · <a href="/dryer-vent-cleaning-tennessee.html">All Middle TN →</a>${dryerLink}<br>
    <b style="display:inline-block;margin-top:8px">Apartment complex or rentals?</b> <a href="/apartment-vent-inspection.html">FREE property inspection →</a> · <a href="/apartment-appliance-repair.html">Apartment vent program →</a><br>
    <b style="display:inline-block;margin-top:8px">🔁 Want it done every year, automatically?</b> <a href="/dryer-vent-cleaning.html#plan">Join the Vent Care Plan →</a>
  </div>
</div>

<div class="done" id="done">
  <div class="ico">✅</div>
  <h2 id="done-h">Got it!</h2>
  <p id="done-p">We just texted you to lock in a day. Reply with the days/times that work and we'll get a tech out.</p>
  <div class="trust" style="margin-top:18px">Questions? Call <a href="tel:+16152802949">615-280-2949</a>.</div>
</div>

<script>
function val(id){return (document.getElementById(id).value||'').trim();}
function showErr(m){var e=document.getElementById('err'); e.textContent=m; e.classList.add('show');}
document.getElementById('submit').onclick=async function(){
  var btn=this; document.getElementById('err').classList.remove('show');
  var name=val('name'), phone=val('phone').replace(/\\D/g,''), problem=val('problem');
  if(!name){ showErr('Please add your name.'); return; }
  if(phone.length<10){ showErr('Please add a valid mobile number.'); return; }
  btn.disabled=true; btn.textContent='Booking…';
  var parts=name.split(/\\s+/); var first=parts.shift(); var last=parts.join(' ');
  var prob=problem || 'Dryer vent cleaning requested (${c.name} ${c.st})';
  try{
    var r=await fetch('/.netlify/functions/book-repair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      first_name:first, last_name:last, phone:phone, appliance_type:'Dryer Vent Cleaning',
      problem:prob, address:val('address'), city:val('city')||'${c.name}', state:val('state')||'${c.st}', zip:val('zip')
    })});
    var d=await r.json();
    if(d&&d.ok){
      try{ gtag('event','generate_lead',{value:1,currency:'USD',items:[{item_id:'dryer_vent_cleaning',item_name:'Dryer Vent Cleaning ${c.name}'}]}); }catch(_){}
      document.getElementById('form-wrap').style.display='none';
      document.getElementById('done-h').textContent='Got it, '+first+'!';
      document.getElementById('done').style.display='block';
      window.scrollTo({top:0,behavior:'smooth'});
    } else { showErr((d&&d.error)||'Something went wrong — please call 615-280-2949.'); btn.disabled=false; btn.textContent='Book my ${c.name} vent cleaning (price-match) →'; }
  }catch(e){ showErr('Connection error — please try again or call 615-280-2949.'); btn.disabled=false; btn.textContent='Book my ${c.name} vent cleaning (price-match) →'; }
};
</script>
<script type="application/ld+json">${JSON.stringify(svcLd)}</script>
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
<script type="application/ld+json">${JSON.stringify(bread)}</script>
</body>
</html>`;
}

function hubHtml() {
  const byRegion = {};
  for (const c of CITIES) { (byRegion[c.region] = byRegion[c.region] || []).push(c); }
  const groups = Object.entries(byRegion).map(([region, list]) => {
    const links = list.map((c) => `<a href="/dryer-vent-cleaning-${c.slug}.html" style="display:inline-block;background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;border-radius:999px;padding:8px 15px;font-size:14px;font-weight:700;text-decoration:none;margin:0 6px 8px 0">${c.name} →</a>`).join('');
    return `<h2 style="font-size:17px;color:#12203a;margin:20px 0 10px">${region}</h2><div>${links}</div>`;
  }).join('');
  const svcLd = { '@context': 'https://schema.org', '@type': 'Service', serviceType: 'Dryer vent cleaning', areaServed: ['Middle Tennessee', 'Nashville', 'Rutherford County', 'Williamson County', 'Wilson County', 'Sumner County', 'Montgomery County'], provider: { '@type': 'LocalBusiness', name: 'TN Appliance Exchange', telephone: '+1-615-280-2949', url: SITE + '/', hasCredential: { '@type': 'EducationalOccupationalCredential', credentialCategory: 'certification', name: 'C-DET — Certified Dryer Exhaust Technician', recognizedBy: { '@type': 'Organization', name: 'Chimney Safety Institute of America (CSIA)', url: 'https://www.csia.org/' } } }, description: 'Same-day dryer vent cleaning across Middle Tennessee — Nashville, Murfreesboro, Franklin, Brentwood, Clarksville and every city in between. CSIA C-DET certified, price-match guaranteed. We also break down and clean the dryer itself.' };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Dryer Vent Cleaning Middle Tennessee — Nashville, Murfreesboro, Franklin</title>
<meta name="description" content="The dryer vent cleaning people for Middle Tennessee — Nashville, Murfreesboro, Franklin, Brentwood, Mt. Juliet, Hendersonville, Clarksville and every city in between. Same-day, price-match guaranteed, CSIA C-DET certified. We're the only crew that also cleans the dryer itself.">
<link rel="canonical" href="${SITE}/dryer-vent-cleaning-tennessee.html">
<meta property="og:title" content="Dryer Vent Cleaning Middle Tennessee — Same-Day, Price-Match">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta name="theme-color" content="#ff8a00">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-0EF3THNXLE"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-0EF3THNXLE');</script>
<style>${css}</style>
</head>
<body>
<div class="brand"><div class="logo">🐜</div><div class="name">TN APPLIANCE EXCHANGE</div></div>
<div id="form-wrap">
  <h1>Dryer vent cleaning across Middle Tennessee</h1>
  <div class="king">👑 We are the dryer vent cleaning people.<span class="sub">Nashville and all of Middle Tennessee — Rutherford, Williamson, Wilson, Sumner &amp; Montgomery counties.</span></div>
  <div class="cred"><span class="seal">🎖️</span> CSIA Certified Dryer Exhaust Technician (C-DET)</div>
  <div class="cred"><span class="seal">💵</span> $80 books a full inspection + up to 2 ft of vent cleaning (applies to your total)</div>
  <div class="lede">From Nashville out to Murfreesboro, Franklin, Brentwood and Clarksville, we clean dryer vents <b>same-day</b>, <b>price-match guaranteed</b> — and we're the only crew that also <b>breaks down and cleans the dryer itself</b>. Long roof runs, two- and three-story homes, single houses and whole apartment complexes. Pick your city:</div>
  ${groups}
  <div class="edge" style="margin-top:22px">
    <div class="eh">🏗️ Why Middle TN vents clog — the new-construction trap</div>
    <p>Middle Tennessee is building faster than almost anywhere in the country, and those new two-story subdivisions in Murfreesboro, Spring Hill, Mt. Juliet and Gallatin almost all run the dryer exhaust a <b>long way up and out the roof</b>. A five-year-old house whose vent has <b>never once been cleaned</b> is the surprise clog nobody expects. Add the older long runs around Nashville and the tree-pollen everyone here knows, and it's no wonder dryers start taking two and three cycles. We clear the whole path, lint trap to wall cap.</p>
  </div>
  <div class="edge" style="margin-top:20px;border-color:#2563eb;background:#eef4ff"><div class="eh" style="color:#12203a">🏢 Apartment communities &amp; property managers</div><p style="color:#22406e">A clogged dryer vent is a <b>fire-code and insurance liability</b> on every unit you manage — and we clean whole properties on <b>one price-matched quote, one invoice</b>, coordinating each tenant ourselves. We are also your <b>preferred appliance-repair vendor</b> (fridges, washers, dryers, ovens) — one call for the whole portfolio. <a href="/apartment-appliance-repair.html" style="color:#2563eb;font-weight:700">Apartment communities →</a> · <a href="/property-management.html" style="color:#2563eb;font-weight:700">Property managers →</a></p></div>
  <div class="trust" style="margin-top:18px">Prefer to talk? Call or text <a href="tel:+16152802949">615-280-2949</a> — a real person answers. Also serving <a href="/dryer-vent-cleaning-louisiana.html" style="color:#ad4e00;font-weight:700;text-decoration:none">Southeast Louisiana →</a></div>
</div>
<script type="application/ld+json">${JSON.stringify(svcLd)}</script>
</body>
</html>`;
}

let n = 0;
for (const c of CITIES) { fs.writeFileSync(path.join(REPO, `dryer-vent-cleaning-${c.slug}.html`), pageHtml(c, CITIES)); n++; }
fs.writeFileSync(path.join(REPO, 'dryer-vent-cleaning-tennessee.html'), hubHtml());
console.log(`Built ${n} TN vent city pages + 1 Middle TN hub. Slugs: ${CITIES.map((c) => c.slug).join(', ')}`);
module.exports = { CITIES };
