// build-lang-pages.js — generate the multilingual homepages (/es/, /vi/, /ar/,
// /hi/, /fr/) from lang-data.js. RTL handled for Arabic. hreflang + a language
// switcher wired across all versions. Re-run after editing translations.
//
// Run:  node tools/seo-build/build-lang-pages.js
'use strict';
const fs = require('fs');
const path = require('path');
const { LANGS, T } = require('./lang-data.js');

const REPO = path.join(__dirname, '..', '..');
const SITE = 'https://tnapplianceexchange.net';

// hreflang block — every page lists every version + the English x-default.
function hreflang() {
  const rows = ['<link rel="alternate" hreflang="en" href="' + SITE + '/">'];
  LANGS.forEach((l) => rows.push('<link rel="alternate" hreflang="' + l.code + '" href="' + SITE + '/' + l.code + '/">'));
  rows.push('<link rel="alternate" hreflang="x-default" href="' + SITE + '/">');
  return rows.join('\n');
}

// language switcher strip — English first, then every translated version.
function switcher(active) {
  const parts = ['<a href="' + SITE + '/"' + (active === 'en' ? ' class="on"' : '') + '>English</a>'];
  LANGS.forEach((l) => parts.push('<a href="/' + l.code + '/"' + (active === l.code ? ' class="on"' : '') + '>' + l.name + '</a>'));
  return '<nav class="langbar">' + parts.join('<span>·</span>') + '</nav>';
}

function page(l) {
  const t = (k) => (T[k] && T[k][l.code]) || '';
  const rtl = l.dir === 'rtl';
  return `<!DOCTYPE html>
<html lang="${l.code}"${rtl ? ' dir="rtl"' : ''}>
<head>
<meta charset="UTF-8">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-0EF3THNXLE"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-0EF3THNXLE');</script>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${t('title')}</title>
<meta name="description" content="${t('desc').replace(/"/g, '&quot;')}">
<link rel="canonical" href="${SITE}/${l.code}/">
${hreflang()}
<meta property="og:title" content="${t('title')}">
<meta property="og:description" content="${t('desc').replace(/"/g, '&quot;')}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/${l.code}/">
<meta property="og:site_name" content="TN Appliance Exchange">
<meta property="og:image" content="${SITE}/og-image.jpg">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--black:#050505;--surface:#0c0c0c;--border:#1a1a1a;--bord2:#252525;--orange:#ff6200;--white:#f0f0f0;--gray:#8a8a8a}
  html,body{background:var(--black);color:var(--white);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6}
  body{max-width:860px;margin:0 auto;padding:18px 18px 80px}
  .top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:22px}
  .brand{font-weight:800;letter-spacing:.04em;font-size:18px}.brand b{color:var(--orange)}
  .langbar{font-size:12px;color:var(--gray);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .langbar a{color:var(--gray);text-decoration:none}.langbar a.on{color:var(--orange);font-weight:700}.langbar span{color:#333}
  h1{font-size:34px;line-height:1.15;margin-bottom:14px;font-weight:800}h1 .a{color:var(--orange)}
  .lede{color:var(--gray);font-size:17px;margin-bottom:24px}.lede b{color:#f0f0f0}
  .cta{display:block;background:var(--orange);color:#000;text-decoration:none;text-align:center;font-weight:800;padding:17px;border-radius:13px;margin:10px 0;font-size:17px}
  .cta.alt{background:transparent;color:var(--white);border:1px solid var(--bord2)}
  .trust{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}
  .trust div{background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:11px 14px;font-size:13px;color:var(--gray)}.trust b{color:var(--white)}
  h2{font-size:23px;margin:38px 0 14px;font-weight:800}
  .step{display:flex;gap:14px;margin-bottom:16px}
  .num{flex:none;width:30px;height:30px;border-radius:50%;background:var(--orange);color:#000;font-weight:800;display:flex;align-items:center;justify-content:center}
  .step b{color:var(--white)}.step p{color:var(--gray);font-size:15px}
  .why div{border-inline-start:2px solid var(--orange);padding:4px 0;padding-inline-start:14px;margin-bottom:14px;color:var(--gray)}.why b{color:var(--white)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}
  .grid div{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:14px;text-align:center}
  .foot{margin-top:46px;border-top:1px solid var(--border);padding-top:18px;font-size:13px;color:#444;text-align:center}.foot a{color:var(--gray);text-decoration:none}
</style>
</head>
<body>
  <div class="top">
    <div class="brand">TN <b>APPLIANCE</b> EXCHANGE 🐜</div>
    ${switcher(l.code)}
  </div>

  <h1>${t('h1pre')} <span class="a">${t('h1acc')}</span></h1>
  <p class="lede">${t('lede')} <b>${t('ledeBold')}</b></p>

  <a class="cta" href="/appliance-ai.html?lang=${l.code}">${t('cta1')}</a>
  <a class="cta alt" href="tel:8662680111">${t('cta2')}</a>

  <div class="trust"><div>${t('trust1')}</div><div>${t('trust2')}</div><div>${t('trust3')}</div></div>

  <h2>${t('h2how')}</h2>
  <div class="step"><div class="num">1</div><div><b>${t('s1t')}</b><p>${t('s1p')}</p></div></div>
  <div class="step"><div class="num">2</div><div><b>${t('s2t')}</b><p>${t('s2p')}</p></div></div>
  <div class="step"><div class="num">3</div><div><b>${t('s3t')}</b><p>${t('s3p')}</p></div></div>
  <div class="step"><div class="num">4</div><div><b>${t('s4t')}</b><p>${t('s4p')}</p></div></div>

  <h2>${t('h2why')}</h2>
  <div class="why"><div>${t('w1')}</div><div>${t('w2')}</div><div>${t('w3')}</div><div>${t('w4')}</div></div>

  <h2>${t('h2fix')}</h2>
  <div class="grid"><div>${t('aWasher')}</div><div>${t('aDryer')}</div><div>${t('aFridge')}</div><div>${t('aDish')}</div><div>${t('aStove')}</div><div>${t('aFreezer')}</div></div>

  <a class="cta" href="/appliance-ai.html?lang=${l.code}">${t('cta1')}</a>

  <div class="foot">${t('foot')}<br><a href="tel:8662680111">(866) 268-0111</a> · <a href="${SITE}/">${t('footEn')}</a></div>

<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","@id":"${SITE}/#business","name":"TN Appliance Exchange","url":"${SITE}/${l.code}/","telephone":"+1-866-268-0111","image":"${SITE}/og-image.jpg","priceRange":"$$","areaServed":[{"@type":"State","name":"Tennessee"},{"@type":"State","name":"Louisiana"}],"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.5","reviewCount":"1079","bestRating":"5"}}</script>
</body>
</html>`;
}

let n = 0;
for (const l of LANGS) {
  const dir = path.join(REPO, l.code);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(l), 'utf8');
  n++;
  console.log('✓ /' + l.code + '/index.html (' + l.name + (l.dir === 'rtl' ? ', RTL' : '') + ')');
}
console.log('\nBuilt ' + n + ' language homepages.');
