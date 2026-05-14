// Shared CSS, nav, footer, and structured-data builders used by all generators.
// Single source of truth so every page looks and behaves identically.

const { SITE, PHONE_TN, PHONE_LA, ALL_CITIES, jsonStr, esc } = require("./shared.js");

// Inline CSS — same aesthetic as existing city pages (dark theme, orange accent, Bebas/Geist/Instrument).
// One declaration of every style used by symptom, brand, hub, calculator, and how-it-works pages.
const SHARED_CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{
  --black:#050505;--surface:#0c0c0c;--surf2:#111;--border:#1a1a1a;--bord2:#252525;
  --orange:#ff6200;--oran2:#ff7c28;--green:#39ff14;--white:#f0f0f0;--gray:#666;--gray2:#333;
  --mono:'Geist Mono',monospace;--serif:'Instrument Serif',serif;--block:'Bebas Neue',sans-serif;
}
html,body{background:#050505 !important;background-color:#050505 !important;color:#f0f0f0;font-family:var(--mono);overflow-x:hidden}
.bg{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.bg-orb{position:absolute;border-radius:50%;filter:blur(160px);animation:breathe 9s ease-in-out infinite alternate}
.orb1{width:800px;height:800px;background:radial-gradient(circle,rgba(255,98,0,.08),transparent 70%);top:-300px;left:-200px}
.orb2{width:500px;height:500px;background:radial-gradient(circle,rgba(57,255,20,.03),transparent 70%);bottom:-100px;right:-100px;animation-delay:4s}
@keyframes breathe{from{transform:scale(1);opacity:.5}to{transform:scale(1.2);opacity:1}}
.bg::after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,98,0,.01) 1px,transparent 1px),linear-gradient(90deg,rgba(255,98,0,.01) 1px,transparent 1px);background-size:72px 72px}
body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;background:repeating-linear-gradient(0deg,transparent 0,transparent 3px,rgba(0,0,0,.025) 3px,rgba(0,0,0,.025) 4px)}
.shell{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column;background:#050505}
nav{display:flex;align-items:center;justify-content:space-between;padding:18px 32px;border-bottom:1px solid var(--border);background:rgba(5,5,5,.9);backdrop-filter:blur(24px);position:sticky;top:0;z-index:100}
.nav-brand{display:flex;align-items:center;gap:10px;text-decoration:none}
.nav-ant{font-size:22px;animation:glow 3s ease-in-out infinite}
@keyframes glow{0%,100%{filter:drop-shadow(0 0 8px rgba(255,98,0,.5))}50%{filter:drop-shadow(0 0 22px rgba(255,98,0,.95))}}
.nav-name{font-family:var(--block);font-size:16px;letter-spacing:.06em;color:var(--white);line-height:1}
.nav-tag{font-size:9px;color:var(--gray);letter-spacing:.1em;text-transform:uppercase;margin-top:1px}
.nav-right{display:flex;align-items:center;gap:14px}
.pill{display:flex;align-items:center;gap:7px;font-size:10px;color:var(--green);border:1px solid rgba(57,255,20,.2);border-radius:20px;padding:5px 12px;background:rgba(57,255,20,.03);letter-spacing:.07em;text-transform:uppercase}
.pill-dot{width:5px;height:5px;background:var(--green);border-radius:50%;animation:pdot 2s ease-in-out infinite}
@keyframes pdot{0%,100%{box-shadow:0 0 0 0 rgba(57,255,20,.5)}50%{box-shadow:0 0 0 5px rgba(57,255,20,0)}}
.nav-call{font-size:11px;color:var(--gray);text-decoration:none;letter-spacing:.04em;transition:color .2s}
.nav-call:hover{color:var(--white)}
.hero{padding:72px 32px 56px;max-width:880px;margin:0 auto;width:100%;animation:hero-in .8s ease forwards;opacity:0}
@keyframes hero-in{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.breadcrumb{font-size:11px;color:var(--gray);letter-spacing:.06em;margin-bottom:24px}
.breadcrumb a{color:var(--gray);text-decoration:none;transition:color .2s}
.breadcrumb a:hover{color:var(--orange)}
.breadcrumb span{color:var(--gray2);margin:0 8px}
.hero-label{font-size:11px;color:var(--orange);letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px}
.hero-icon{font-size:48px;margin-bottom:16px;display:block}
h1{font-family:var(--block);font-size:clamp(40px,7.5vw,68px);letter-spacing:.04em;line-height:1;margin-bottom:20px;color:var(--white)}
h1 em{color:var(--orange);font-style:normal;display:block}
.hero-sub{font-size:14px;color:var(--gray);line-height:1.8;letter-spacing:.02em;max-width:620px;margin-bottom:32px}
.hero-sub strong{color:var(--white);font-weight:500}
.cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:40px}
.btn-primary{display:inline-flex;align-items:center;gap:8px;background:var(--orange);color:#000;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:14px 24px;border-radius:10px;text-decoration:none;transition:all .2s;border:none;cursor:pointer}
.btn-primary:hover{background:var(--oran2);transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,98,0,.3)}
.btn-secondary{display:inline-flex;align-items:center;gap:8px;background:transparent;color:var(--white);font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:14px 24px;border-radius:10px;text-decoration:none;transition:all .2s;border:1px solid var(--bord2)}
.btn-secondary:hover{border-color:var(--orange);color:var(--orange)}
.quick-answer{background:linear-gradient(135deg,rgba(255,98,0,.07),rgba(255,98,0,.02));border:1px solid rgba(255,98,0,.25);border-radius:14px;padding:24px 28px;margin-bottom:24px;position:relative}
.quick-answer::before{content:'QUICK ANSWER';position:absolute;top:-9px;left:20px;background:#050505;font-family:var(--block);font-size:11px;letter-spacing:.16em;color:var(--orange);padding:0 8px}
.quick-answer p{font-size:14px;color:var(--white);line-height:1.7;letter-spacing:.01em;font-family:var(--mono)}
.content{max-width:880px;margin:0 auto;padding:0 32px 80px;width:100%}
.section{margin-bottom:56px}
.section-label{font-size:10px;color:var(--orange);letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px}
h2{font-family:var(--block);font-size:clamp(28px,5vw,40px);letter-spacing:.04em;line-height:1.1;margin-bottom:18px;color:var(--white)}
h3{font-family:var(--block);font-size:18px;letter-spacing:.04em;color:var(--white);margin-bottom:8px;line-height:1.2}
.prose{font-size:14px;color:var(--gray);line-height:1.85;letter-spacing:.01em}
.prose strong{color:var(--white);font-weight:500}
.prose p{margin-bottom:14px}
.prose a{color:var(--orange);text-decoration:none;border-bottom:1px solid rgba(255,98,0,.3);transition:border-color .2s}
.prose a:hover{border-color:var(--orange)}
.cause-list{display:flex;flex-direction:column;gap:12px;margin-top:20px}
.cause{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px;transition:border-color .2s}
.cause:hover{border-color:rgba(255,98,0,.4)}
.cause h3{margin-bottom:6px;font-size:16px}
.cause p{font-size:13px;color:var(--gray);line-height:1.7;letter-spacing:.01em}
.tdr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}
.tdr-card{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 16px;transition:border-color .2s}
.tdr-card:hover{border-color:rgba(255,98,0,.4)}
.tdr-num{font-family:var(--block);font-size:14px;color:var(--orange);letter-spacing:.08em;margin-bottom:8px}
.tdr-name{font-family:var(--block);font-size:15px;color:var(--white);letter-spacing:.04em;margin-bottom:8px;line-height:1.2}
.tdr-desc{font-size:11px;color:var(--gray);line-height:1.55}
.pricing-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:20px}
.price-row{background:var(--surface);border:1px solid var(--bord2);border-radius:10px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.price-row-label{font-size:12px;color:var(--white);letter-spacing:.03em}
.price-row-amt{font-family:var(--block);font-size:18px;color:var(--orange);letter-spacing:.04em;text-align:right}
.credit-note{margin-top:18px;padding:18px 22px;background:rgba(57,255,20,.04);border:1px solid rgba(57,255,20,.15);border-radius:10px;font-size:13px;color:#e8e8e8;line-height:1.7;letter-spacing:.01em}
.credit-note b{color:var(--green);font-weight:500}
.faq{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.faq-item{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px;transition:border-color .2s}
.faq-item:hover{border-color:rgba(255,98,0,.4)}
.faq-q{font-size:14px;color:var(--white);font-weight:500;letter-spacing:.01em;margin-bottom:10px;font-family:var(--mono)}
.faq-a{font-size:13px;color:var(--gray);line-height:1.75;letter-spacing:.01em}
.cta-section{background:var(--surface);border:1px solid rgba(255,98,0,.2);border-radius:16px;padding:48px 32px;text-align:center;margin-bottom:56px;position:relative;overflow:hidden}
.cta-section::before{content:'';position:absolute;top:-50px;right:-50px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(255,98,0,.06),transparent 70%);pointer-events:none}
.cta-section h2{margin-bottom:12px}
.cta-section p{font-size:14px;color:var(--gray);margin-bottom:28px;line-height:1.7;max-width:560px;margin-left:auto;margin-right:auto}
.cta-section .cta-row{justify-content:center}
.warning-note{margin-top:14px;padding:14px 18px;background:rgba(255,98,0,.05);border-left:3px solid var(--orange);border-radius:6px;font-size:12px;color:var(--gray);line-height:1.7;font-style:italic}
.warning-note b{color:var(--orange);font-style:normal}
.related-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:18px}
.related-link{background:var(--surface);border:1px solid var(--bord2);border-radius:10px;padding:16px 18px;text-decoration:none;color:var(--white);font-size:13px;letter-spacing:.02em;transition:all .2s;display:flex;align-items:center;gap:10px}
.related-link:hover{border-color:var(--orange);color:var(--orange)}
.related-link::after{content:'→';margin-left:auto;color:var(--gray);transition:color .2s,transform .2s}
.related-link:hover::after{color:var(--orange);transform:translateX(4px)}
.cities-tag{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.city-tag{display:inline-flex;align-items:center;font-size:11px;color:var(--gray);background:var(--surface);border:1px solid var(--bord2);border-radius:14px;padding:6px 12px;text-decoration:none;letter-spacing:.04em;transition:all .2s}
.city-tag:hover{border-color:var(--orange);color:var(--orange)}
.brand-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:18px}
.brand-link{background:var(--surface);border:1px solid var(--bord2);border-radius:10px;padding:14px 16px;text-decoration:none;color:var(--white);font-size:12px;letter-spacing:.04em;transition:all .2s;text-align:center;font-family:var(--block)}
.brand-link:hover{border-color:var(--orange);color:var(--orange)}
.process-steps{display:flex;flex-direction:column;gap:14px;margin-top:22px;counter-reset:step}
.process-step{display:flex;gap:18px;align-items:flex-start;padding:22px 24px;background:var(--surface);border:1px solid var(--bord2);border-radius:12px;transition:border-color .2s}
.process-step:hover{border-color:rgba(255,98,0,.4)}
.process-num{font-family:var(--block);font-size:36px;color:var(--orange);line-height:1;flex-shrink:0;width:44px}
.process-content h3{margin-bottom:6px;font-size:16px}
.process-content p{font-size:13px;color:var(--gray);line-height:1.7;letter-spacing:.01em}
footer{border-top:1px solid var(--border);padding:28px 32px 32px;display:flex;flex-direction:column;align-items:center;gap:16px;background:#050505;margin-top:auto}
footer .foot-links{display:flex;gap:18px;flex-wrap:wrap;justify-content:center}
footer a{font-size:11px;color:var(--gray);text-decoration:none;letter-spacing:.04em;transition:color .2s}
footer a:hover{color:var(--orange)}
footer span{color:var(--gray2);font-size:11px}
footer .foot-tag{font-size:10px;color:var(--gray2);letter-spacing:.1em;text-transform:uppercase;text-align:center}
@media(max-width:780px){
  .tdr-grid{grid-template-columns:repeat(2,1fr)}
  .pricing-grid{grid-template-columns:1fr}
  .related-grid{grid-template-columns:1fr}
}
@media(max-width:600px){
  nav{padding:14px 18px}.nav-call,.nav-tag{display:none}
  .hero{padding:48px 20px 36px}.content{padding:0 20px 60px}
  .quick-answer{padding:22px 20px}
  .cta-section{padding:36px 20px}
  .process-step{padding:18px 20px;gap:12px}
  .process-num{font-size:28px;width:30px}
}
`.replace(/\s*\n\s*/g, "").replace(/\s{2,}/g, " ");

// Build the <head> block. Includes all SEO meta, schema, OG, Twitter, canonical, fonts.
function buildHead({ slug, title, metaTitle, metaDesc, keywords, schemas }) {
  const url = `${SITE}/${slug}`;
  const schemaBlock = schemas.map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-0EF3THNXLE"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-0EF3THNXLE');</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(metaTitle)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="keywords" content="${esc(keywords)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#050505">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(metaTitle)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:site_name" content="TN Appliance Exchange">
<meta property="og:image" content="${SITE}/og-default.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(metaTitle)}">
<meta name="twitter:description" content="${esc(metaDesc)}">
${schemaBlock}
<style>html{background-color:#050505 !important}</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Geist+Mono:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>${SHARED_CSS}</style>
</head>`;
}

// Standard nav block.
function buildNav() {
  return `<nav>
<a href="/" class="nav-brand"><span class="nav-ant">🐜</span><div><div class="nav-name">TN Appliance Exchange</div><div class="nav-tag">Stop Guessing. Ask a Technician.</div></div></a>
<div class="nav-right"><div class="pill"><span class="pill-dot"></span>Ant is online</div><a href="tel:${PHONE_TN.replace(/-/g,"")}" class="nav-call">${PHONE_TN}</a></div>
</nav>`;
}

// Standard footer block. Used on every generated page.
function buildFooter() {
  const tnList = ["Nashville","Murfreesboro","Antioch","Clarksville","Franklin","Hermitage","Hendersonville"];
  const laList = ["New Orleans","Baton Rouge","Hammond","Metairie","Slidell","Mandeville","Covington"];
  const tnLinks = tnList.map(n => `<a href="/${n.toLowerCase().replace(/\s+/g,"-").replace(".","")}">${esc(n)}</a>`).join("<span>·</span>");
  const laLinks = laList.map(n => `<a href="/${n.toLowerCase().replace(/\s+/g,"-").replace(".","")}">${esc(n)}</a>`).join("<span>·</span>");
  return `<footer>
<div class="foot-links">${tnLinks}<span>·</span>${laLinks}</div>
<div class="foot-links">
<a href="/how-it-works">How It Works</a><span>·</span>
<a href="/should-i-repair-or-replace">Repair or Replace?</a><span>·</span>
<a href="/appliance-ant">Appliance Ant</a><span>·</span>
<a href="/dryer-repair">Dryer Repair</a><span>·</span>
<a href="/washer-repair">Washer Repair</a><span>·</span>
<a href="/refrigerator-repair">Refrigerator Repair</a><span>·</span>
<a href="/privacy">Privacy</a><span>·</span>
<a href="/terms">SMS Terms</a>
</div>
<div class="foot-tag">TN Appliance Exchange · ${PHONE_TN} (TN) · ${PHONE_LA} (LA) · Family-owned, technician-led.</div>
</footer>`;
}

// JSON-LD: LocalBusiness — same NAP on every page.
function schemaLocalBusiness() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${SITE}/#business`,
    name: "TN Appliance Exchange",
    description: "Family-owned appliance repair serving Middle Tennessee and Louisiana. Honest 4-option Technician Decision Report. Diagnostic fee credited to your repair.",
    url: SITE,
    telephone: PHONE_TN,
    priceRange: "$50-$600",
    image: `${SITE}/og-default.png`,
    address: {
      "@type": "PostalAddress",
      addressRegion: "TN",
      addressCountry: "US"
    },
    areaServed: [
      { "@type": "City", name: "Nashville", containedInPlace: { "@type": "State", name: "Tennessee" } },
      { "@type": "City", name: "Murfreesboro", containedInPlace: { "@type": "State", name: "Tennessee" } },
      { "@type": "City", name: "Antioch", containedInPlace: { "@type": "State", name: "Tennessee" } },
      { "@type": "City", name: "Clarksville", containedInPlace: { "@type": "State", name: "Tennessee" } },
      { "@type": "City", name: "New Orleans", containedInPlace: { "@type": "State", name: "Louisiana" } },
      { "@type": "City", name: "Baton Rouge", containedInPlace: { "@type": "State", name: "Louisiana" } },
      { "@type": "City", name: "Hammond", containedInPlace: { "@type": "State", name: "Louisiana" } }
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.6",
      reviewCount: "323"
    }
  };
}

// JSON-LD: Service entry.
function schemaService(label) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: label || "Appliance Repair",
    serviceType: "Appliance Repair",
    provider: { "@id": `${SITE}/#business` },
    areaServed: ["Tennessee", "Louisiana"]
  };
}

// JSON-LD: FAQPage from array of {q, a}.
function schemaFAQ(faqs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(f => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
}

// JSON-LD: BreadcrumbList.
function schemaBreadcrumbs(crumbs) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url
    }))
  };
}

// The 4 TDR option cards. Reused on every symptom/brand/hub page.
function renderTDRGrid() {
  return `<div class="tdr-grid">
<div class="tdr-card"><div class="tdr-num">Option 1</div><div class="tdr-name">OEM Part Only</div><div class="tdr-desc">We source the exact OEM part and ship directly to you. You install. Best for confident DIYers who want guaranteed-fit parts.</div></div>
<div class="tdr-card"><div class="tdr-num">Option 2</div><div class="tdr-name">Amazon Equivalent Part Only</div><div class="tdr-desc">We source a verified compatible part at a lower price and ship directly. You install. Cost-effective when fit is straightforward.</div></div>
<div class="tdr-card"><div class="tdr-num">Option 3</div><div class="tdr-name">OEM Part + Labor</div><div class="tdr-desc">We source the OEM part, ship it, and our technician installs it. Best when fit is critical or labor access is complex.</div></div>
<div class="tdr-card"><div class="tdr-num">Option 4</div><div class="tdr-name">Equivalent Part + Labor</div><div class="tdr-desc">We source an equivalent part, ship it, and install it. Balances cost and convenience.</div></div>
</div>
<div class="warning-note"><b>Important if you choose labor:</b> do not start the job yourself. Once an appliance has been opened or partially worked on, our technician may need to charge additional labor — or may decline to take over the repair.</div>`;
}

// Pricing section reused across all pages.
function renderPricingBlock() {
  return `<div class="pricing-grid">
<div class="price-row"><span class="price-row-label">Quick Check (chat + tech review)</span><span class="price-row-amt">$50</span></div>
<div class="price-row"><span class="price-row-label">In-Home Diagnostic</span><span class="price-row-amt">$100</span></div>
<div class="price-row"><span class="price-row-label">Most dryer repairs</span><span class="price-row-amt">$150-$300</span></div>
<div class="price-row"><span class="price-row-label">Most washer repairs</span><span class="price-row-amt">$200-$350</span></div>
<div class="price-row"><span class="price-row-label">Most refrigerator repairs</span><span class="price-row-amt">$200-$600</span></div>
<div class="price-row"><span class="price-row-label">Sealed-system &amp; specialty</span><span class="price-row-amt">starting at $200</span></div>
</div>
<div class="credit-note"><b>Your diagnostic fee is never wasted.</b> Every dollar you spend on the Quick Check ($50) or in-home diagnostic ($100) goes directly toward your repair labor if you decide to move forward. You're not paying for a diagnosis AND a repair — you're paying for a diagnosis that becomes a credit toward your repair. No double paying, ever.</div>`;
}

// Render related-symptom internal links.
function renderRelated(slugs, allSymptoms) {
  return slugs.map(s => {
    const sym = allSymptoms.find(x => x.slug === s);
    const title = sym ? sym.title : s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return `<a href="/${s}" class="related-link">${esc(title)}</a>`;
  }).join("");
}

// All 7 service-city slugs as link tags.
function renderCityTags() {
  const featured = ["nashville","murfreesboro","antioch","clarksville","new-orleans","baton-rouge","hammond"];
  return featured.map(slug => {
    const c = ALL_CITIES.find(x => x.slug === slug);
    return `<a href="/${slug}" class="city-tag">${esc(c.name)}</a>`;
  }).join("");
}

// Top 7 brand internal links.
function renderBrandLinks() {
  const brands = ["whirlpool","samsung","lg","ge","frigidaire","maytag","bosch"];
  return brands.map(b => {
    const label = b === "ge" ? "GE" : b === "lg" ? "LG" : b[0].toUpperCase() + b.slice(1);
    return `<a href="/${b}-appliance-repair" class="brand-link">${esc(label)}</a>`;
  }).join("");
}

// Standard "How the TDR works" intro paragraph used inside content.
const ANT_CTA_TEXT = `Chat with Ant — tell us what's wrong, share a quick video and your model number photo, and a real technician will build your Technician Decision Report. No hold music, no guessing, no commitment until you see your options.`;

module.exports = {
  buildHead, buildNav, buildFooter,
  schemaLocalBusiness, schemaService, schemaFAQ, schemaBreadcrumbs,
  renderTDRGrid, renderPricingBlock, renderRelated, renderCityTags, renderBrandLinks,
  ANT_CTA_TEXT, SHARED_CSS, esc, jsonStr
};
