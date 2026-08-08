// build-es-landers.js — Spanish LOCAL landers: "Reparación de <aparato> en <ciudad>".
// Captures local Spanish search intent (e.g. "reparación de lavadoras en Nashville")
// and funnels to the /es/fix/ DIY guides + the $50 Revisión Rápida + the 888 line.
//
// Each page is substantial (local intro + real problem list linking to the DIY
// guides + brands + repair-vs-replace + localized FAQ + LocalBusiness/FAQ schema),
// so it's not a thin doorway page. Spanish slugs, self-canonical, 888 phone.
//
// Run:  node scripts/build-es-landers.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'es', 'reparacion');
const BASE = 'https://tnapplianceexchange.net';
const PHONE = '1-888-268-8998';
const TEL = '+18882688998';
const QC = '/quick-check-intake.html?lang=es';
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Appliance = the local keyword head. fixes link into the /es/fix/ library (internal
// authority + real content). intro is the appliance-specific opening line.
const APPLIANCES = [
  { key: 'lavadora', label: 'lavadoras', h: 'lavadora', slug: 'lavadora',
    intro: 'Una lavadora descompuesta detiene la casa. La arreglamos rápido y con honestidad — y si es algo simple, te decimos cómo hacerlo tú mismo.',
    fixes: [ ['washer-wont-drain','La lavadora no drena'], ['washer-not-spinning','La lavadora no centrifuga'], ['lavadora-no-enciende','La lavadora no enciende'], ['lavadora-pierde-agua','La lavadora gotea o pierde agua'], ['lavadora-huele-mal','La lavadora huele mal'], ['lavadora-no-llena','La lavadora no se llena de agua'] ] },
  { key: 'secadora', label: 'secadoras', h: 'secadora', slug: 'secadora',
    intro: 'Una secadora que no seca (o que tarda tres ciclos) casi siempre es el ducto o una pieza económica. La reparamos y limpiamos el ducto — que también previene incendios.',
    fixes: [ ['dryer-not-heating','La secadora no calienta'], ['secadora-no-enciende','La secadora no enciende'], ['secadora-hace-ruido','La secadora hace ruido'], ['secadora-tarda-mucho','La secadora tarda mucho en secar'] ] },
  { key: 'refrigerador', label: 'refrigeradores', h: 'refrigerador', slug: 'refrigerador',
    intro: 'Cuando el refrigerador falla, cada hora cuenta por la comida. Llegamos rápido con un diagnóstico honesto de reparar vs. reemplazar.',
    fixes: [ ['refrigerator-not-cooling','El refrigerador no enfría'], ['refrigerador-hace-ruido','El refrigerador hace ruido'], ['refrigerador-gotea-agua','El refrigerador gotea agua'], ['no-hace-hielo','La fábrica de hielo no funciona'], ['refrigerador-congela-demasiado','El refrigerador congela la comida'], ['dispensador-agua-no-funciona','El dispensador de agua no funciona'], ['congelador-no-enfria','El congelador no enfría'] ] },
  { key: 'lavavajillas', label: 'lavavajillas', h: 'lavavajillas', slug: 'lavavajillas',
    intro: 'Un lavavajillas que no drena o no limpia suele tener un arreglo simple. Te ayudamos a resolverlo — tú mismo o con un técnico.',
    fixes: [ ['dishwasher-wont-drain','El lavavajillas no drena'], ['lavavajillas-no-limpia','El lavavajillas no limpia bien'], ['lavavajillas-no-seca','El lavavajillas no seca los platos'] ] },
  { key: 'estufa', label: 'estufas y hornos', h: 'estufa u horno', slug: 'estufa',
    intro: 'Estufas, hornos y microondas — de gas o eléctricos. Reparamos con seguridad y te decimos la verdad sobre si vale la pena arreglarlo.',
    fixes: [ ['oven-not-heating','El horno no calienta'], ['estufa-gas-no-enciende','El quemador de gas no enciende'], ['estufa-electrica-no-calienta','El quemador eléctrico no calienta'], ['horno-no-mantiene-temperatura','El horno no mantiene la temperatura'], ['microondas-no-calienta','El microondas no calienta'] ] },
  { key: 'congelador', label: 'congeladores', h: 'congelador', slug: 'congelador',
    intro: 'Un congelador que no enfría es una carrera contra el reloj — tu comida. La mayoría de las fallas (el sistema de deshielo, el relé de arranque, el termostato) son arreglos económicos. Sea horizontal, vertical o empotrado, te decimos con honestidad qué necesita antes de tocarlo.',
    fixes: [ ['congelador-no-enfria','El congelador no enfría'], ['no-hace-hielo','La fábrica de hielo no funciona'], ['refrigerador-gotea-agua','Fugas o charcos de agua'] ] },
];

const BRANDS = ['Whirlpool', 'Samsung', 'LG', 'GE', 'Frigidaire', 'Maytag', 'Kenmore', 'KitchenAid', 'Amana', 'Bosch'];

// Spanish-population-weighted cities across both markets. blurb = a short, unique
// local line so the top of each page differs meaningfully (not a thin template).
const CITIES = [
  { name: 'Nashville', slug: 'nashville', st: 'TN', region: 'el centro de Tennessee', blurb: 'Damos servicio en todo Nashville y sus alrededores, incluida la comunidad hispana del corredor de Nolensville Road y el sureste de la ciudad.' },
  { name: 'Antioch', slug: 'antioch', st: 'TN', region: 'el sureste de Nashville', blurb: 'Antioch es nuestra base — atendemos a sus familias todos los días, con atención en español.' },
  { name: 'Murfreesboro', slug: 'murfreesboro', st: 'TN', region: 'el condado de Rutherford', blurb: 'Servicio a domicilio en todo Murfreesboro y el condado de Rutherford, a menudo el mismo día.' },
  { name: 'Smyrna', slug: 'smyrna', st: 'TN', region: 'el condado de Rutherford', blurb: 'Atendemos a las familias de Smyrna con reparación rápida y honesta, en español.' },
  { name: 'La Vergne', slug: 'la-vergne', st: 'TN', region: 'el condado de Rutherford', blurb: 'La Vergne tiene una fuerte comunidad hispana y aquí estamos para ayudarla en su idioma.' },
  { name: 'Hermitage', slug: 'hermitage', st: 'TN', region: 'el este de Nashville', blurb: 'Servicio a domicilio en Hermitage y el este de Davidson, rápido y sin sorpresas.' },
  { name: 'Mount Juliet', slug: 'mount-juliet', st: 'TN', region: 'el condado de Wilson', blurb: 'Reparamos electrodomésticos en Mount Juliet y sus alrededores, con diagnóstico honesto.' },
  { name: 'Clarksville', slug: 'clarksville', st: 'TN', region: 'el norte de Tennessee', blurb: 'Damos servicio en Clarksville y la zona de Fort Campbell, con atención en español.' },
  { name: 'Franklin', slug: 'franklin', st: 'TN', region: 'el condado de Williamson', blurb: 'Servicio a domicilio en Franklin y el condado de Williamson.' },
  { name: 'Hendersonville', slug: 'hendersonville', st: 'TN', region: 'el condado de Sumner', blurb: 'Reparamos en Hendersonville y la ribera del lago Old Hickory.' },
  { name: 'Nueva Orleans', slug: 'nueva-orleans', st: 'LA', region: 'el área metropolitana de Nueva Orleans', blurb: 'Atendemos a la comunidad hispana de Nueva Orleans con reparación honesta y en español.' },
  { name: 'Metairie', slug: 'metairie', st: 'LA', region: 'la parroquia de Jefferson', blurb: 'Metairie y Kenner tienen una gran comunidad latina — aquí estamos para servirla.' },
  { name: 'Kenner', slug: 'kenner', st: 'LA', region: 'la parroquia de Jefferson', blurb: 'Servicio a domicilio en Kenner y toda la parroquia de Jefferson, con atención en español.' },
  { name: 'Baton Rouge', slug: 'baton-rouge', st: 'LA', region: 'el área de Baton Rouge', blurb: 'Reparamos electrodomésticos en todo Baton Rouge y sus alrededores.' },
  { name: 'Hammond', slug: 'hammond', st: 'LA', region: 'la parroquia de Tangipahoa', blurb: 'Damos servicio en Hammond y la parroquia de Tangipahoa.' },
  { name: 'Gonzales', slug: 'gonzales', st: 'LA', region: 'la parroquia de Ascension', blurb: 'Servicio en Gonzales y el área de Ascension, con diagnóstico honesto.' },
  { name: 'Laplace', slug: 'laplace', st: 'LA', region: 'la parroquia de St. John', blurb: 'Reparamos en Laplace y la comunidad de la parroquia de St. John.' },
  { name: 'Slidell', slug: 'slidell', st: 'LA', region: 'la parroquia de St. Tammany', blurb: 'Servicio a domicilio en Slidell y la Costa Norte (North Shore).' },
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
      <h2>¿Listo para arreglarlo? Empieza en español</h2>
      <p>Con la <b>Revisión Rápida de $50</b> envías un video corto y una foto del número de modelo, y un técnico de verdad te dice qué está mal y tus opciones — los $50 se acreditan a tu reparación. O llámanos y agendamos una visita.</p>
      <div class="btnrow">
        <a class="btn p" href="${QC}">Empieza tu Revisión Rápida de $50 →</a>
        <a class="btn s" href="tel:${TEL}">Llámanos o escríbenos · ${PHONE}</a>
      </div>
    </div>`;
}

function lander(city, app) {
  const url = `${BASE}/es/reparacion/${app.slug}-${city.slug}.html`;
  const title = `Reparación de ${app.label} en ${city.name}, ${city.st}`;
  const metaDesc = `Reparación de ${app.label} en ${city.name}, ${city.st} — rápida, honesta y con atención en español. Revisión Rápida de $50 (se acredita a tu reparación) o visita a domicilio. Llama al ${PHONE}.`;
  const problems = app.fixes.map(([slug, txt]) => `      <a href="/es/fix/${slug}.html">${esc(txt)}<b>Ver la guía →</b></a>`).join('\n');
  // other appliances in the same city (internal linking)
  const near = APPLIANCES.filter((a) => a.key !== app.key).map((a) => `<a href="/es/reparacion/${a.slug}-${city.slug}.html">Reparación de ${esc(a.label)} en ${esc(city.name)}</a>`).join('\n        ');

  const localBiz = { '@context': 'https://schema.org', '@type': 'ApplianceRepair', name: 'TN Appliance Exchange', telephone: TEL, url,
    areaServed: { '@type': 'City', name: city.name, addressRegion: city.st, addressCountry: 'US' },
    priceRange: '$$', image: BASE + '/og-image.jpg', inLanguage: 'es',
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '1082' } };
  const faqs = [
    { q: `¿Reparan ${app.label} en ${city.name}?`, a: `Sí. Damos servicio a domicilio de ${app.label} en ${city.name} y ${city.region}, con atención en español y a menudo el mismo día. También puedes empezar con la Revisión Rápida de $50 desde tu teléfono.` },
    { q: `¿Cuánto cuesta reparar una ${app.h} en ${city.name}?`, a: `Con la Revisión Rápida de $50 un técnico revisa tu video y te da un precio claro y honesto antes de que gastes de más — y esos $50 se acreditan a tu reparación. Precios fijos, sin sorpresas.` },
    { q: `¿Atienden en español?`, a: `Sí — atención en español por teléfono, texto y en línea. Llámanos o escríbenos al ${PHONE}.` },
    { q: `¿Puedo arreglar mi ${app.h} yo mismo?`, a: `Muchas veces sí. Tenemos guías gratis en español para los problemas más comunes; si es simple, te decimos la pieza exacta. Y si necesitas un técnico, vamos a ${city.name}.` },
  ];
  const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: 'es', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/es/' },
    { '@type': 'ListItem', position: 2, name: 'Reparación por ciudad', item: BASE + '/es/reparacion/' },
    { '@type': 'ListItem', position: 3, name: title, item: url } ] };
  const faqHtml = faqs.map((f) => `        <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n');

  return `<!doctype html>
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
<script type="application/ld+json">${JSON.stringify(localBiz)}</script>
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
    <nav class="bc"><a href="/es/">Inicio</a> › <a href="/es/reparacion/">Reparación por ciudad</a> › ${esc(city.name)}</nav>
    <h1>Reparación de ${esc(app.label)} en <span class="a">${esc(city.name)}, ${esc(city.st)}</span></h1>
    <div class="lede">${esc(app.intro)} ${esc(city.blurb)}</div>
    <div class="badges"><span class="badge">✅ Atención en español</span><span class="badge">⚡ A menudo el mismo día</span><span class="badge">💵 Precios fijos, sin sorpresas</span><span class="badge">🐜 Familia desde 2012 · 4.5★ (1,082 reseñas)</span></div>

    <h2>Problemas comunes de ${esc(app.label)}</h2>
    <p>Estas son las fallas que más vemos en ${esc(city.name)}. Toca una para ver la guía gratis en español — te decimos qué revisar tú mismo y cuándo conviene un técnico:</p>
    <div class="problems">
${problems}
    </div>

    <h2>Reparar o reemplazar — te decimos la verdad</h2>
    <p>No todo vale la pena repararlo, y no queremos que gastes de más. Con la Revisión Rápida de $50, un técnico de verdad revisa tu video y te da la comparación honesta antes de decidir. En ${esc(city.name)} atendemos ${esc(app.label)} de todas las marcas: ${esc(BRANDS.join(', '))} y más.</p>

${ctaBlock()}

    <h2>Preguntas frecuentes</h2>
    <div class="faq">
${faqHtml}
    </div>

    <h2>Otras reparaciones en ${esc(city.name)}</h2>
    <div class="near">
        ${near}
    </div>

    <footer>
      <p><b>TN Appliance Exchange</b> — reparación de electrodomésticos honesta y dirigida por técnicos desde 2012, con atención en español. Servicio a domicilio en ${esc(city.name)} y ${esc(city.region)}; ayuda por video en todo EE. UU. Llámanos o escríbenos al ${PHONE}.</p>
      <p style="margin-top:8px"><a href="/es/reparacion/">Todas las ciudades</a> · <a href="/es/fix/">Guías de reparación</a> · <a href="/es/">Inicio</a></p>
    </footer>
  </div>
</body>
</html>`;
}

function hub() {
  const byCity = CITIES.map((c) => {
    const links = APPLIANCES.map((a) => `<a href="/es/reparacion/${a.slug}-${c.slug}.html">${esc(a.label)}</a>`).join(' · ');
    return `      <div class="cityblock"><h3>${esc(c.name)}, ${esc(c.st)}</h3><div class="citylinks">${links}</div></div>`;
  }).join('\n');
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [ { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/es/' }, { '@type': 'ListItem', position: 2, name: 'Reparación por ciudad', item: BASE + '/es/reparacion/' } ] };
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reparación de electrodomésticos por ciudad — atención en español | TN Appliance Exchange</title>
<meta name="description" content="Reparación de electrodomésticos con atención en español en Tennessee y Luisiana. Encuentra tu ciudad y tu aparato — lavadora, secadora, refrigerador, lavavajillas, estufa. Revisión Rápida de $50. ${PHONE}.">
<link rel="canonical" href="${BASE}/es/reparacion/">
<link rel="alternate" hreflang="es" href="${BASE}/es/reparacion/">
<meta name="robots" content="index,follow,max-snippet:-1">
<script type="application/ld+json">${JSON.stringify(bc)}</script>
<style>${CSS}
.cityblock{background:var(--surf);border:1px solid var(--bord);border-radius:12px;padding:14px 16px;margin:10px 0}
.cityblock h3{font-size:16px;color:var(--orange);margin:0 0 6px}
.citylinks{font-size:14px;color:var(--dim)}
.citylinks a{color:var(--ink);text-decoration:none}
.citylinks a:hover{color:var(--orange)}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/es/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:${TEL}">Llámanos o escríbenos 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/es/">Inicio</a> › Reparación por ciudad</nav>
    <h1>Reparación de electrodomésticos <span class="a">en tu ciudad</span></h1>
    <div class="lede">Atención en español en el centro de Tennessee y el sur de Luisiana. Elige tu ciudad y tu electrodoméstico — o empieza con la Revisión Rápida de $50 desde tu teléfono.</div>
${ctaBlock()}
    <h2>Ciudades que atendemos</h2>
${byCity}
    <footer><p><b>TN Appliance Exchange</b> — reparación honesta dirigida por técnicos desde 2012, atención en español. ${PHONE}. <a href="/es/fix/">Guías de reparación</a> · <a href="/es/">Inicio</a></p></footer>
  </div>
</body>
</html>`;
}

// ---- write ----
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const urls = [];
for (const c of CITIES) {
  for (const a of APPLIANCES) {
    fs.writeFileSync(path.join(OUT, `${a.slug}-${c.slug}.html`), lander(c, a));
    urls.push(`${BASE}/es/reparacion/${a.slug}-${c.slug}.html`);
  }
}
fs.writeFileSync(path.join(OUT, 'index.html'), hub());
urls.push(`${BASE}/es/reparacion/`);
console.log('Wrote ' + urls.length + ' Spanish local landers (' + CITIES.length + ' cities × ' + APPLIANCES.length + ' appliances + hub) to /es/reparacion/');
// print the url list for the sitemap step
fs.writeFileSync(path.join(__dirname, '.es-lander-urls.txt'), urls.join('\n'));
