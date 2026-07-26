// build-es-national-landers.js — Spanish landers for the big Spanish-speaking METROS
// OUTSIDE our on-site area (Miami, Houston, LA, NYC, El Paso...). We do NOT do house
// calls there, so these sell the HONEST nationwide model: a real technician diagnoses
// your appliance by video ($50, credited to the repair), we ship the exact part to
// your door, and free Spanish DIY guides walk you through it. First-mover: almost
// nobody serves these communities in Spanish.
//
// Path: /es/diagnostico/<ciudad>.html  + hub /es/diagnostico/
// Metro list + priority informed by real Keyword Planner data (market-finder).
//
// Run:  node scripts/build-es-national-landers.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'es', 'diagnostico');
const BASE = 'https://tnapplianceexchange.net';
const PHONE = '1-888-268-8998';
const TEL = '+18882688998';
const QC = '/quick-check-intake.html?lang=es';
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Real DIY guides we link into (internal authority). A representative spread.
const FIXES = [
  ['washer-wont-drain', 'La lavadora no drena'],
  ['dryer-not-heating', 'La secadora no calienta'],
  ['refrigerator-not-cooling', 'El refrigerador no enfría'],
  ['no-hace-hielo', 'La fábrica de hielo no funciona'],
  ['lavavajillas-no-limpia', 'El lavavajillas no limpia'],
  ['estufa-gas-no-enciende', 'El quemador de gas no enciende'],
  ['microondas-no-calienta', 'El microondas no calienta'],
  ['lavadora-pierde-agua', 'La lavadora pierde agua'],
];
const BRANDS = ['Whirlpool', 'Samsung', 'LG', 'GE', 'Frigidaire', 'Maytag', 'Kenmore', 'KitchenAid', 'Amana', 'Bosch'];

// Metros ranked by the real Spanish demand pull. blurb = a unique local line so no
// two pages are thin duplicates. vol = ES searches/mo (from market-finder) — used
// only to order the hub, not shown.
const METROS = [
  { name: 'Los Ángeles', slug: 'los-angeles', st: 'CA', vol: 210, blurb: 'Los Ángeles tiene una de las comunidades hispanas más grandes del país. Aquí te atendemos en español y te ayudamos a arreglar tu electrodoméstico sin que te cobren de más.' },
  { name: 'Miami', slug: 'miami', st: 'FL', vol: 140, blurb: 'En Miami hablamos tu idioma. Un técnico de verdad revisa tu electrodoméstico por video y te dice la verdad — repara tú mismo con nuestra guía o te enviamos la pieza exacta.' },
  { name: 'Nueva York', slug: 'nueva-york', st: 'NY', vol: 130, blurb: 'Del Bronx a Queens, servimos a la comunidad latina de Nueva York con diagnóstico honesto en español y la pieza enviada a tu puerta.' },
  { name: 'Houston', slug: 'houston', st: 'TX', vol: 120, blurb: 'Houston tiene una enorme comunidad hispana y muy pocos técnicos que atiendan en español. Nosotros sí — por video, con la pieza enviada a tu casa.' },
  { name: 'El Paso', slug: 'el-paso', st: 'TX', vol: 100, blurb: 'En El Paso casi todos hablamos español. Te damos un diagnóstico honesto por video y te enviamos la pieza exacta — sin que salgas de casa.' },
  { name: 'Chicago', slug: 'chicago', st: 'IL', vol: 90, blurb: 'La comunidad mexicana y latina de Chicago merece servicio honesto en su idioma. Diagnóstico por video en español y la pieza enviada a tu puerta.' },
  { name: 'San Antonio', slug: 'san-antonio', st: 'TX', vol: 80, blurb: 'San Antonio es orgullosamente latino. Te ayudamos en español a arreglar tu electrodoméstico — tú mismo con nuestra guía o con la pieza que te enviamos.' },
  { name: 'Phoenix', slug: 'phoenix', st: 'AZ', vol: 80, blurb: 'En Phoenix atendemos a la comunidad hispana con un técnico real que revisa tu problema por video y te dice qué pieza necesitas.' },
  { name: 'Orlando', slug: 'orlando', st: 'FL', vol: 80, blurb: 'Orlando y su gran comunidad puertorriqueña y latina merecen respuestas honestas en español. Te las damos por video, con la pieza enviada a tu casa.' },
  { name: 'Las Vegas', slug: 'las-vegas', st: 'NV', vol: 80, blurb: 'En Las Vegas te atendemos en español — un técnico de verdad revisa tu electrodoméstico por video y te envía la pieza exacta a tu puerta.' },
  { name: 'San Diego', slug: 'san-diego', st: 'CA', vol: 80, blurb: 'San Diego, tan cerca de la frontera, merece servicio en español. Diagnóstico honesto por video y la pieza enviada a tu casa.' },
  { name: 'Denver', slug: 'denver', st: 'CO', vol: 80, blurb: 'La comunidad latina de Denver crece cada año. Te atendemos en español con un diagnóstico honesto por video y la pieza enviada a tu puerta.' },
  { name: 'Atlanta', slug: 'atlanta', st: 'GA', vol: 80, blurb: 'Atlanta tiene una comunidad hispana fuerte y en crecimiento. Te ayudamos en español a arreglar tu electrodoméstico — por video y con la pieza enviada.' },
  { name: 'Dallas', slug: 'dallas', st: 'TX', vol: 70, blurb: 'Dallas–Fort Worth es hogar de miles de familias latinas. Te damos un diagnóstico honesto en español y te enviamos la pieza exacta a tu casa.' },
  { name: 'Tampa', slug: 'tampa', st: 'FL', vol: 70, blurb: 'En Tampa atendemos a la comunidad latina en español — un técnico real revisa tu problema por video y te dice exactamente qué necesitas.' },
  { name: 'McAllen', slug: 'mcallen', st: 'TX', vol: 70, blurb: 'En McAllen y todo el Valle del Río Grande, el español es el idioma de casa. Te damos servicio honesto por video y la pieza enviada a tu puerta.' },
  { name: 'Riverside', slug: 'riverside', st: 'CA', vol: 70, blurb: 'El Inland Empire tiene una gran comunidad latina. Te atendemos en español con diagnóstico honesto por video y la pieza enviada a casa.' },
  { name: 'Fresno', slug: 'fresno', st: 'CA', vol: 60, blurb: 'En el Valle Central de California te servimos en español — un técnico de verdad revisa tu electrodoméstico por video y te envía la pieza exacta.' },
  // --- Área de DC (DMV): DC + Maryland + el norte de Virginia. Una de las
  //     comunidades salvadoreñas y centroamericanas más grandes del país. ---
  { name: 'Washington DC', slug: 'washington-dc', st: 'DC', vol: 110, blurb: 'El área de DC tiene una enorme comunidad salvadoreña y centroamericana. Te atendemos en español: un técnico de verdad revisa tu electrodoméstico por video y te envía la pieza exacta a tu puerta.' },
  { name: 'Silver Spring', slug: 'silver-spring', st: 'MD', vol: 90, blurb: 'Silver Spring es hogar de miles de familias latinas. Te damos un diagnóstico honesto en español por video y te enviamos la pieza correcta a tu casa.' },
  { name: 'Langley Park', slug: 'langley-park', st: 'MD', vol: 70, blurb: 'En Langley Park, el español es el idioma de casa. Aquí te atendemos en tu idioma — diagnóstico honesto por video y la pieza enviada a tu puerta.' },
  { name: 'Hyattsville', slug: 'hyattsville', st: 'MD', vol: 60, blurb: 'Hyattsville y el condado de Prince George tienen una fuerte comunidad centroamericana. Te ayudamos en español a arreglar tu electrodoméstico, por video y con la pieza enviada.' },
  { name: 'Wheaton', slug: 'wheaton', st: 'MD', vol: 60, blurb: 'En Wheaton te servimos en español — un técnico real revisa tu problema por video y te dice exactamente qué pieza necesitas.' },
  { name: 'Gaithersburg', slug: 'gaithersburg', st: 'MD', vol: 70, blurb: 'Gaithersburg y Montgomery County tienen una gran comunidad latina. Diagnóstico honesto en español por video y la pieza enviada a tu casa.' },
  { name: 'Arlington', slug: 'arlington-va', st: 'VA', vol: 80, blurb: 'En Arlington y el norte de Virginia te atendemos en español, con un diagnóstico honesto por video y la pieza exacta enviada a tu puerta.' },
  { name: 'Alexandria', slug: 'alexandria-va', st: 'VA', vol: 80, blurb: 'Alexandria tiene una comunidad salvadoreña muy fuerte. Te ayudamos en español — por video, con la pieza enviada a tu casa.' },
  { name: 'Annandale', slug: 'annandale-va', st: 'VA', vol: 60, blurb: 'En Annandale y el condado de Fairfax te servimos en español, con diagnóstico honesto por video y envío de la pieza correcta.' },
  { name: 'Woodbridge', slug: 'woodbridge-va', st: 'VA', vol: 60, blurb: 'Woodbridge y el condado de Prince William tienen una gran comunidad latina. Te atendemos en español, por video, con la pieza enviada a tu puerta.' },
  { name: 'Manassas', slug: 'manassas-va', st: 'VA', vol: 50, blurb: 'En Manassas te ayudamos en español a arreglar tu electrodoméstico — un técnico de verdad por video y la pieza exacta a tu casa.' },
  { name: 'Baltimore', slug: 'baltimore', st: 'MD', vol: 90, blurb: 'La comunidad latina de Baltimore crece cada año. Te damos un diagnóstico honesto en español por video y te enviamos la pieza a tu puerta.' },
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
      <h2>Empieza en español — desde tu teléfono</h2>
      <p>Con la <b>Revisión Rápida de $50</b> envías un video corto y una foto del número de modelo. Un técnico de verdad te dice qué está mal y tus opciones, y los $50 se acreditan a la pieza o reparación. Te enviamos la pieza exacta a tu puerta — o te guiamos para que lo arregles tú mismo.</p>
      <div class="btnrow">
        <a class="btn p" href="${QC}">Empieza tu Revisión Rápida de $50 →</a>
        <a class="btn s" href="tel:${TEL}">Llámanos o escríbenos · ${PHONE}</a>
      </div>
    </div>`;
}

function lander(m) {
  const url = `${BASE}/es/diagnostico/${m.slug}.html`;
  const title = `Reparación de electrodomésticos en ${m.name}, ${m.st} — atención en español`;
  const metaDesc = `¿Se te descompuso un electrodoméstico en ${m.name}? Un técnico de verdad te ayuda en español: diagnóstico por video ($50, se acredita), te enviamos la pieza exacta a tu puerta, y guías DIY gratis. Llama al ${PHONE}.`;
  const problems = FIXES.map(([slug, txt]) => `      <a href="/es/fix/${slug}.html">${esc(txt)}<b>Ver la guía gratis →</b></a>`).join('\n');
  const near = METROS.filter((x) => x.slug !== m.slug).slice(0, 8).map((x) => `<a href="/es/diagnostico/${x.slug}.html">${esc(x.name)}</a>`).join('\n        ');

  const svc = { '@context': 'https://schema.org', '@type': 'Service', name: `Diagnóstico de electrodomésticos por video y envío de piezas — ${m.name}`,
    serviceType: 'Reparación de electrodomésticos (diagnóstico por video + envío de piezas)', provider: { '@type': 'Organization', name: 'TN Appliance Exchange', telephone: TEL, url: BASE + '/es/' },
    areaServed: { '@type': 'City', name: m.name, addressRegion: m.st, addressCountry: 'US' }, url, inLanguage: 'es',
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '1082' } };
  const faqs = [
    { q: `¿Van a mi casa en ${m.name}?`, a: `En ${m.name} no hacemos visitas a domicilio todavía — pero sí te ayudamos igual de bien: un técnico de verdad revisa tu electrodoméstico por video, te dice exactamente qué falla y te enviamos la pieza exacta a tu puerta, con una guía para instalarla. Si prefieres, tenemos guías gratis en español para arreglarlo tú mismo.` },
    { q: `¿Cómo funciona la Revisión Rápida de $50?`, a: `Nos envías un video corto de la falla y una foto del número de modelo. Un técnico real lo revisa y te da un diagnóstico honesto con tus opciones y precio. Los $50 se acreditan a la pieza o a lo que compres con nosotros. Todo en español, desde tu teléfono.` },
    { q: `¿Me pueden enviar la pieza a ${m.name}?`, a: `Sí. Enviamos piezas a todo Estados Unidos, incluido ${m.name}. Una vez que sabemos el modelo y la falla, te mandamos la pieza correcta a tu puerta — sin adivinar, sin comprar la equivocada.` },
    { q: `¿Atienden en español?`, a: `Sí — todo en español: por teléfono, por texto y en línea. Llámanos o escríbenos al ${PHONE}. Somos una empresa familiar desde 2012.` },
    { q: `¿Puedo arreglarlo yo mismo?`, a: `Muchas veces sí, y te ayudamos a lograrlo. Tenemos guías gratis en español para las fallas más comunes, y si necesitas la pieza, te la enviamos con instrucciones. Tú decides cuánto quieres hacer.` },
  ];
  const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: 'es', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/es/' },
    { '@type': 'ListItem', position: 2, name: 'Ayuda por ciudad', item: BASE + '/es/diagnostico/' },
    { '@type': 'ListItem', position: 3, name: title, item: url } ] };
  const faqHtml = faqs.map((f) => `        <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n');

  return `<!doctype html>
<!-- ant-build:2 -->
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | TN Appliance Exchange</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="es" href="${url}">
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
      <a class="brand" href="/es/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:${TEL}">Llámanos o escríbenos 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/es/">Inicio</a> › <a href="/es/diagnostico/">Ayuda por ciudad</a> › ${esc(m.name)}</nav>
    <h1>Reparación de electrodomésticos en <span class="a">${esc(m.name)}, ${esc(m.st)}</span> — en español</h1>
    <div class="lede">${esc(m.blurb)}</div>
    <div class="badges"><span class="badge">✅ Atención en español</span><span class="badge">📹 Diagnóstico por video $50</span><span class="badge">📦 Te enviamos la pieza exacta</span><span class="badge">🐜 Familia desde 2012 · 4.5★ (1,082 reseñas)</span></div>

    <h2>Cómo te ayudamos en ${esc(m.name)}</h2>
    <div class="steps">
      <div class="step"><div class="n">1</div><h3>Nos muestras la falla</h3><p>Un video corto y una foto del número de modelo, desde tu teléfono. Todo en español.</p></div>
      <div class="step"><div class="n">2</div><h3>Un técnico real te dice la verdad</h3><p>Diagnóstico honesto con tus opciones y precio — no adivinamos, no te cobramos de más.</p></div>
      <div class="step"><div class="n">3</div><h3>Te enviamos la pieza</h3><p>La pieza exacta llega a tu puerta con instrucciones — o te guiamos para arreglarlo tú mismo.</p></div>
    </div>

    <h2>Guías gratis en español</h2>
    <p>Estas son las fallas más comunes. Toca una para ver la guía gratis — te decimos qué revisar tú mismo con seguridad y cuándo conviene la pieza o un técnico:</p>
    <div class="problems">
${problems}
    </div>

    <h2>Reparar o reemplazar — te decimos la verdad</h2>
    <p>No todo vale la pena repararlo, y no queremos que gastes de más. Con la Revisión Rápida de $50, un técnico de verdad revisa tu video y te da la comparación honesta antes de decidir. Trabajamos con todas las marcas: ${esc(BRANDS.join(', '))} y más.</p>

${ctaBlock()}

    <h2>Preguntas frecuentes — ${esc(m.name)}</h2>
    <div class="faq">
${faqHtml}
    </div>

    <h2>Otras ciudades</h2>
    <div class="near">
        ${near}
    </div>

    <footer>
      <p><b>TN Appliance Exchange</b> — reparación de electrodomésticos honesta y dirigida por técnicos desde 2012, con atención en español. En ${esc(m.name)} ayudamos por video y enviamos piezas a todo EE. UU. Llámanos o escríbenos al ${PHONE}.</p>
      <p style="margin-top:8px"><a href="/es/diagnostico/">Todas las ciudades</a> · <a href="/es/fix/">Guías de reparación</a> · <a href="/es/">Inicio</a></p>
    </footer>
  </div>
</body>
</html>`;
}

function hub() {
  const ordered = METROS.slice().sort((a, b) => b.vol - a.vol);
  const cards = ordered.map((m) => `      <a href="/es/diagnostico/${m.slug}.html" class="mcard"><h3>${esc(m.name)}, ${esc(m.st)}</h3><p>${esc(m.blurb.slice(0, 90))}…</p></a>`).join('\n');
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [ { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/es/' }, { '@type': 'ListItem', position: 2, name: 'Ayuda por ciudad', item: BASE + '/es/diagnostico/' } ] };
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reparación de electrodomésticos en español — en toda la nación | TN Appliance Exchange</title>
<meta name="description" content="Atención en español para reparar tus electrodomésticos donde vivas: diagnóstico por video ($50), te enviamos la pieza exacta a tu puerta, y guías DIY gratis. Miami, Houston, Los Ángeles y más. ${PHONE}.">
<link rel="canonical" href="${BASE}/es/diagnostico/">
<link rel="alternate" hreflang="es" href="${BASE}/es/diagnostico/">
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
      <a class="brand" href="/es/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:${TEL}">Llámanos o escríbenos 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/es/">Inicio</a> › Ayuda por ciudad</nav>
    <h1>Reparación de electrodomésticos <span class="a">en español, donde vivas</span></h1>
    <div class="lede">Un técnico de verdad te ayuda en español desde tu teléfono: diagnóstico por video ($50, se acredita), te enviamos la pieza exacta a tu puerta y tienes guías DIY gratis. Elige tu ciudad o empieza ahora mismo.</div>
${ctaBlock()}
    <h2>Ciudades que atendemos en español</h2>
    <div class="mgrid">
${cards}
    </div>
    <footer><p><b>TN Appliance Exchange</b> — reparación honesta dirigida por técnicos desde 2012, atención en español, envío de piezas a todo EE. UU. ${PHONE}. <a href="/es/fix/">Guías de reparación</a> · <a href="/es/">Inicio</a></p></footer>
  </div>
</body>
</html>`;
}

// ---- write ----
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const urls = [];
for (const m of METROS) {
  fs.writeFileSync(path.join(OUT, `${m.slug}.html`), lander(m));
  urls.push(`${BASE}/es/diagnostico/${m.slug}.html`);
}
fs.writeFileSync(path.join(OUT, 'index.html'), hub());
urls.push(`${BASE}/es/diagnostico/`);
console.log('Wrote ' + urls.length + ' Spanish national metro landers (' + METROS.length + ' metros + hub) to /es/diagnostico/');
fs.writeFileSync(path.join(__dirname, '.es-national-lander-urls.txt'), urls.join('\n'));
