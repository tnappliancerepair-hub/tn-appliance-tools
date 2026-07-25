// build-troubleshooting-pages-es.js — Spanish twin of build-troubleshooting-pages.js.
// Renders scripts/troubleshooting-content-es.js into /es/fix/<slug>.html + a /es/fix/
// hub, with Spanish FAQ + HowTo + BreadcrumbList schema, hreflang paired to the
// English /fix/ pages, the 888 Spanish line, and a lead CTA into the $50 Revisión
// Rápida (quick-check-intake.html?lang=es) + DIY-friendly framing.
//
// Run:  node scripts/build-troubleshooting-pages-es.js
'use strict';
const fs = require('fs');
const path = require('path');
const ITEMS = require('./troubleshooting-content-es');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'es', 'fix');
const BASE = 'https://tnapplianceexchange.net';
const PHONE = '1-888-268-8998';           // the Spanish line → Ann — Closer (Español)
const TEL = '+18882688998';
const QC = '/quick-check-intake.html?lang=es';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const stripQ = (q) => q.replace(/ — ¿qué hago\?$/, '');
const TAG = { Easy: 'Revisión fácil', Moderate: 'Revisión moderada', Pro: 'Técnico' };

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
    name: 'Qué revisar de forma segura cuando ' + stripQ(item.question).toLowerCase(),
    inLanguage: 'es', about: item.appliance,
    step: steps,
  } : null;
}

function ctaBlock() {
  return `    <div class="cta">
      <h2>Una respuesta real — hoy, desde donde estés</h2>
      <p>¿En el centro de Tennessee o el área de Baton Rouge? Vamos a tu casa. ¿En cualquier otro lugar de EE. UU.? Empieza con la <b>Revisión Rápida de $50</b>: envías un video de 10 segundos y una foto del número de modelo, un técnico de verdad te dice exactamente qué está mal, y los $50 se acreditan a tu reparación. Y si es algo simple, hasta te decimos la pieza exacta para que lo hagas tú mismo.</p>
      <div class="btnrow">
        <a class="btn p" href="${QC}">Empieza tu Revisión Rápida de $50 →</a>
        <a class="btn s" href="tel:${TEL}">Llámanos o escríbenos · ${PHONE}</a>
      </div>
    </div>`;
}

function page(item) {
  const url = `${BASE}/es/fix/${item.slug}.html`;
  // Only pair hreflang/"In English" with an English page that actually exists on
  // disk (the original 6 use English slugs). Spanish-only topics use Spanish slugs
  // and stand alone (self-canonical), so we never link to a 404.
  const hasEn = fs.existsSync(path.join(ROOT, 'fix', item.slug + '.html'));
  const enUrl = hasEn ? `${BASE}/fix/${item.slug}.html` : '';
  const related = ITEMS.filter((x) => x.slug !== item.slug).slice(0, 3);

  const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: 'es', mainEntity: item.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/es/' },
    { '@type': 'ListItem', position: 2, name: 'Guías de reparación', item: BASE + '/es/fix/' },
    { '@type': 'ListItem', position: 3, name: item.appliance + ' — ' + stripQ(item.question), item: url },
  ] };
  const howto = howToSteps(item);
  const schemas = [faqSchema, bc].concat(howto ? [howto] : []);

  const causesHtml = item.causes.map((c) => `      <div class="cause">
        <h3>${esc(c.name)} <span class="tag ${c.difficulty}">${TAG[c.difficulty] || c.difficulty}</span></h3>
        <p class="why">${esc(c.why)}</p>
        <p class="check"><b>Revísalo:</b> ${esc(c.diy)}</p>
      </div>`).join('\n');

  const faqHtml = item.faqs.map((f) => `        <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n');
  const relatedHtml = related.map((r) => `<a href="/es/fix/${r.slug}.html">${esc(stripQ(r.question))}</a>`).join('\n        ');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(item.metaTitle)} | TN Appliance Exchange</title>
<meta name="description" content="${esc(item.metaDesc)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="es" href="${url}">${hasEn ? `
<link rel="alternate" hreflang="en" href="${enUrl}">
<link rel="alternate" hreflang="x-default" href="${enUrl}">` : ''}
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
      <a class="brand" href="/es/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:${TEL}">Llámanos o escríbenos 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/es/">Inicio</a> › <a href="/es/fix/">Guías de reparación</a> › ${esc(item.appliance)}</nav>
    <h1>${esc(item.question)}</h1>
    <p class="lede">${esc(item.intro)}</p>
    <div class="safety"><b>⚠ Primero la seguridad:</b> ${esc(item.safety)}</div>

    <h2>Las causas más probables</h2>
${causesHtml}

    <h2>¿Vale la pena arreglarlo?</h2>
    <p>${esc(item.repairReplace)}</p>

${ctaBlock()}

    <h2>Preguntas frecuentes</h2>
    <div class="faq">
${faqHtml}
    </div>

    <h2>Reparaciones relacionadas</h2>
    <div class="related">
        ${relatedHtml}
    </div>

    <footer>
      <p><b>TN Appliance Exchange</b> — reparación de electrodomésticos honesta y dirigida por técnicos desde 2012. Servicio a domicilio en el centro de Tennessee y el área de Baton Rouge, Luisiana; diagnóstico por video a nivel nacional con envío de piezas. Estamos 24/7/365 al ${PHONE}.${hasEn ? ` <a href="${enUrl}">In English</a>` : ''}</p>
      <p style="margin-top:8px"><a href="/es/fix/">Todas las guías de reparación</a> · <a href="/es/">Inicio</a></p>
    </footer>
  </div>
</body>
</html>`;
}

function hub() {
  const cards = ITEMS.map((it) => `      <a class="card" href="/es/fix/${it.slug}.html">
        <span class="ap">${esc(it.appliance)}</span>
        <span class="q">${esc(stripQ(it.question))}</span>
      </a>`).join('\n');
  const itemList = { '@context': 'https://schema.org', '@type': 'ItemList', inLanguage: 'es', name: 'Guías de reparación de electrodomésticos', itemListElement: ITEMS.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/es/fix/${it.slug}.html`, name: it.question })) };
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [ { '@type': 'ListItem', position: 1, name: 'Inicio', item: BASE + '/es/' }, { '@type': 'ListItem', position: 2, name: 'Guías de reparación', item: BASE + '/es/fix/' } ] };
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guías de reparación de electrodomésticos — Respuestas honestas de técnicos reales | TN Appliance Exchange</title>
<meta name="description" content="Respuestas claras a los problemas más comunes de electrodomésticos, de técnicos que los reparan a diario. Qué está mal, qué es seguro revisar tú mismo, y si vale la pena arreglarlo. Ayuda 24/7 en todo EE. UU.">
<link rel="canonical" href="${BASE}/es/fix/">
<link rel="alternate" hreflang="es" href="${BASE}/es/fix/">
<link rel="alternate" hreflang="en" href="${BASE}/fix/">
<link rel="alternate" hreflang="x-default" href="${BASE}/fix/">
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
      <a class="brand" href="/es/">TN Appliance<b>·</b>Ant</a>
      <a class="callbtn" href="tel:${TEL}">Llámanos o escríbenos 24/7 · ${PHONE}</a>
    </header>
    <nav class="bc"><a href="/es/">Inicio</a> › Guías de reparación</nav>
    <h1>Guías de reparación de electrodomésticos</h1>
    <p class="lede">Respuestas claras y honestas a los problemas más comunes de electrodomésticos — de técnicos que los reparan todos los días. Qué es lo más probable, qué es seguro revisar tú mismo, y si vale la pena repararlo. ¿Atorado? Envíanos un video cuando quieras y te decimos exactamente qué pasa.</p>
    <div class="grid">
${cards}
    </div>
${ctaBlock()}
    <footer><p><b>TN Appliance Exchange</b> — reparación honesta dirigida por técnicos desde 2012. 24/7/365 al ${PHONE}. <a href="${BASE}/fix/">In English</a></p></footer>
  </div>
</body>
</html>`;
}

// ---- write ----
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const urls = [];
ITEMS.forEach((it) => {
  fs.writeFileSync(path.join(OUT, it.slug + '.html'), page(it));
  urls.push(`${BASE}/es/fix/${it.slug}.html`);
});
fs.writeFileSync(path.join(OUT, 'index.html'), hub());
urls.push(`${BASE}/es/fix/`);
console.log('Wrote ' + (ITEMS.length + 1) + ' Spanish pages to /es/fix/:');
urls.forEach((u) => console.log('  ' + u));
