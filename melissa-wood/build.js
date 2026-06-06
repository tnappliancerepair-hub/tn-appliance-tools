#!/usr/bin/env node
// Static site generator for Melissa Wood Real Estate.
// Premium Florida-realtor aesthetic. ~100 pages. Generated from data templates.
// Run: node build.js (outputs to current directory)

const fs = require('fs');
const path = require('path');

// BASE prefix for all internal links. While staged inside tn-appliance-tools
// Netlify deploy, the site lives at /melissa-wood/. When Melissa points
// melissawoodrealty.com directly at the site (root deploy), set BASE = ''.
const BASE = '/melissa-wood';

const AGENT = {
  name: 'Melissa Wood',
  firstName: 'Melissa',
  brokerage: 'Florida Executive Realty',
  brokerageShort: 'FER',
  phone: '813-310-9901',
  phoneHref: 'tel:+18133109901',
  email: 'melizzawood@gmail.com',
  emailHref: 'mailto:melizzawood@gmail.com',
  primaryArea: 'Tampa Bay',
  serviceArea: '100-mile radius of Tampa Bay',
  domain: 'melissawoodrealty.com',
  logoMelissa: `${BASE}/logos/melissa-wood-logo.png`,
  logoBrokerage: `${BASE}/logos/florida-executive-realty-logo.png`,
};

// Tampa Bay area imagery (Unsplash hosted - free use for personal/commercial)
const IMAGES = {
  hero: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1920&q=85&auto=format',
  // Per-neighborhood imagery - mix of waterfront, Tampa scenes, luxury homes
  tampa: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=85&auto=format',
  southTampa: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=85&auto=format',
  northTampa: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=85&auto=format',
  newTampa: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=85&auto=format',
  brandon: 'https://images.unsplash.com/photo-1605715218800-d2e9e4ab9e72?w=800&q=85&auto=format',
  valrico: 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=85&auto=format',
  wesleyChapel: 'https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?w=800&q=85&auto=format',
  ruskin: 'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=800&q=85&auto=format',
  apolloBeach: 'https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=85&auto=format',
  waterfront: 'https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=85&auto=format',
};

const NEIGHBORHOODS = [
  { slug: 'tampa', name: 'Tampa', tag: 'The heart of Tampa Bay', img: IMAGES.tampa, features: ['Downtown waterfront', 'Riverwalk', 'Top employers', 'Major hospitals'] },
  { slug: 'south-tampa', name: 'South Tampa', tag: 'Old-money charm and walkable streets', img: IMAGES.southTampa, features: ['Bayshore Boulevard', 'Hyde Park Village', 'Top-rated schools', 'Plant High School district'] },
  { slug: 'north-tampa', name: 'North Tampa', tag: 'Family neighborhoods with USF proximity', img: IMAGES.northTampa, features: ['Close to USF', 'Busch Gardens nearby', 'New developments', 'Affordable single-family'] },
  { slug: 'new-tampa', name: 'New Tampa', tag: 'Master-planned communities and great schools', img: IMAGES.newTampa, features: ['Tampa Palms', 'Hunters Green', 'Cross Creek', 'Top-ranked schools'] },
  { slug: 'brandon', name: 'Brandon', tag: 'Suburban Tampa with quick I-75 access', img: IMAGES.brandon, features: ['Brandon Mall', 'I-75 commute', 'Family-friendly', 'Great value per sq ft'] },
  { slug: 'valrico', name: 'Valrico', tag: 'Estate homes and gated communities', img: IMAGES.valrico, features: ['FishHawk-adjacent', 'Larger lots', 'A-rated schools', 'Established neighborhoods'] },
  { slug: 'wesley-chapel', name: 'Wesley Chapel', tag: 'One of Florida\'s fastest-growing communities', img: IMAGES.wesleyChapel, features: ['Wiregrass Mall', 'Florida Hospital', 'New construction', 'Excellent schools'] },
  { slug: 'ruskin', name: 'Ruskin', tag: 'Affordable waterfront living south of Tampa', img: IMAGES.ruskin, features: ['Little Manatee River', 'Bay access', 'New developments', 'I-75 corridor'] },
  { slug: 'riverview', name: 'Riverview', tag: 'Family suburbs with strong value', img: IMAGES.tampa, features: ['Master-planned communities', 'Great schools', 'I-75 access', 'New construction'] },
  { slug: 'apollo-beach', name: 'Apollo Beach', tag: 'Tampa Bay\'s premier waterfront community', img: IMAGES.apolloBeach, features: ['Deep water access', 'Manatee Viewing Center', 'Boating community', 'Luxury waterfront homes'] },
  { slug: 'fishhawk', name: 'FishHawk Ranch', tag: 'Award-winning master-planned community', img: IMAGES.valrico, features: ['Top-rated schools', 'Resort amenities', 'Family-focused', 'Multiple villages'] },
  { slug: 'bloomingdale', name: 'Bloomingdale', tag: 'Established Brandon-area neighborhood', img: IMAGES.brandon, features: ['Mature trees', 'Bloomingdale Golf Club', 'Family communities', 'Strong schools'] },
  { slug: 'carrollwood', name: 'Carrollwood', tag: 'Classic Tampa neighborhood with lake access', img: IMAGES.northTampa, features: ['Lake Carroll', 'Original Carrollwood Village', 'Mature trees', 'Central location'] },
  { slug: 'westchase', name: 'Westchase', tag: 'Master-planned community on Tampa\'s west side', img: IMAGES.newTampa, features: ['Top schools', 'Walkable village center', 'Country club', 'Family-friendly'] },
  { slug: 'lutz', name: 'Lutz', tag: 'Country living minutes from the city', img: IMAGES.wesleyChapel, features: ['Lake Park', 'Larger lots', 'A-rated schools', 'Close to Wesley Chapel + N. Tampa'] },
  { slug: 'land-o-lakes', name: 'Land O\' Lakes', tag: 'Wide-open space and waterfront homes', img: IMAGES.waterfront, features: ['Lakes and ponds', 'Pasco County prices', 'Quick to N. Tampa', 'Growing community'] },
  { slug: 'plant-city', name: 'Plant City', tag: 'Charming small-town feel between Tampa and Lakeland', img: IMAGES.brandon, features: ['Strawberry Festival', 'Historic downtown', 'Affordable', 'I-4 access'] },
  { slug: 'sun-city-center', name: 'Sun City Center', tag: 'Florida\'s premier 55+ community', img: IMAGES.ruskin, features: ['Golf courses', 'Active adult community', 'Maintenance-free living', 'Affordable retirement'] },
  { slug: 'davis-islands', name: 'Davis Islands', tag: 'Walkable island living in downtown Tampa', img: IMAGES.tampa, features: ['Tampa General Hospital', 'Walkable village', 'Boating community', 'Luxury homes'] },
  { slug: 'hyde-park', name: 'Hyde Park', tag: 'Tampa\'s most historic and walkable neighborhood', img: IMAGES.southTampa, features: ['Hyde Park Village', 'Bayshore Boulevard', 'Historic homes', 'Walkable to downtown'] },
  { slug: 'soho', name: 'SoHo (South Howard)', tag: 'Trendy dining and nightlife district', img: IMAGES.southTampa, features: ['Restaurants + bars', 'Walkable', 'Young professionals', 'New townhomes'] },
  { slug: 'channelside', name: 'Channelside', tag: 'Modern condos and downtown energy', img: IMAGES.tampa, features: ['Sparkman Wharf', 'Amalie Arena', 'Cruise terminal', 'New high-rises'] },
  { slug: 'seminole-heights', name: 'Seminole Heights', tag: 'Tampa\'s hippest historic neighborhood', img: IMAGES.northTampa, features: ['Craft beer + dining', 'Bungalow homes', 'Young families', 'Revitalized'] },
  { slug: 'temple-terrace', name: 'Temple Terrace', tag: 'Established community with golf and river access', img: IMAGES.brandon, features: ['Hillsborough River', 'Golf course', 'USF nearby', 'Mature trees'] },
];

const BUYER_GUIDES = [
  { slug: 'first-time-buyer', title: 'First-Time Homebuyer Guide for Tampa Bay', intent: 'Buying your first home' },
  { slug: 'move-up-buyer', title: 'Move-Up Buyer Guide: Selling and Buying Together', intent: 'Upgrading to a larger home' },
  { slug: 'downsizing', title: 'Downsizing in Tampa Bay: What to Know', intent: 'Right-sizing for the next chapter' },
  { slug: 'investment-property', title: 'Tampa Investment Property Guide', intent: 'Building a rental portfolio' },
  { slug: 'relocating-to-tampa', title: 'Relocating to Tampa Bay: Complete Guide', intent: 'Moving to Florida' },
  { slug: 'out-of-state-buyer', title: 'Out-of-State Buyer Guide for Tampa', intent: 'Buying from out of state' },
  { slug: 'new-construction', title: 'New Construction Home Buying in Tampa Bay', intent: 'Working with builders' },
  { slug: 'condo-buyer', title: 'Tampa Condo Buyer Guide', intent: 'Buying a condo in Tampa' },
  { slug: 'waterfront-buyer', title: 'Waterfront Home Buying Guide', intent: 'Living on the water in Tampa Bay' },
  { slug: '55-plus-communities', title: '55+ Community Buyer Guide for Tampa Bay', intent: 'Active adult living' },
  { slug: 'cash-buyer', title: 'Cash Buyer Guide for Tampa Real Estate', intent: 'Buying with cash' },
  { slug: 'fha-loan-buyer', title: 'FHA Loan Homebuyer Guide for Tampa', intent: 'FHA financing' },
  { slug: 'va-loan-buyer', title: 'VA Loan Buyer Guide for Tampa Veterans', intent: 'VA loan benefits' },
  { slug: 'closing-costs-buyer', title: 'Buyer Closing Costs in Tampa Bay', intent: 'What you\'ll actually pay at closing' },
  { slug: 'home-inspection-guide', title: 'Tampa Home Inspection Guide', intent: 'What inspectors look for' },
];

const SELLER_GUIDES = [
  { slug: 'pre-listing-prep', title: 'Pre-Listing Prep Checklist for Tampa Bay Sellers', intent: 'Getting your home ready' },
  { slug: 'pricing-your-home', title: 'How to Price Your Tampa Bay Home Right', intent: 'Setting the right list price' },
  { slug: 'home-staging', title: 'Home Staging Guide for Florida Homes', intent: 'Showing your home at its best' },
  { slug: 'listing-photography', title: 'Why Listing Photography Matters', intent: 'Getting professional photos' },
  { slug: 'open-houses', title: 'Open Houses in Tampa Bay: Worth It?', intent: 'When open houses help' },
  { slug: 'negotiating-offers', title: 'How to Negotiate Offers on Your Home', intent: 'Multiple offers + counter strategy' },
  { slug: 'fsbo-vs-agent', title: 'FSBO vs. Real Estate Agent in Tampa', intent: 'Should you sell yourself?' },
  { slug: 'selling-investment-property', title: 'Selling an Investment Property in Tampa Bay', intent: '1031 exchange and tax planning' },
  { slug: 'selling-inherited-property', title: 'Selling Inherited Property in Florida', intent: 'Probate and step-up basis' },
  { slug: 'selling-in-divorce', title: 'Selling Your Home During Divorce', intent: 'Coordinating with attorneys' },
  { slug: 'selling-and-buying-simultaneously', title: 'Selling and Buying at the Same Time', intent: 'Bridge loans and contingencies' },
  { slug: 'closing-costs-seller', title: 'Seller Closing Costs in Tampa Bay', intent: 'What sellers pay at closing' },
  { slug: 'capital-gains-tax', title: 'Capital Gains Tax on Florida Home Sales', intent: '$250k/$500k exclusion explained' },
  { slug: 'selling-waterfront', title: 'Selling a Waterfront Home in Tampa Bay', intent: 'Buyer pool and pricing' },
  { slug: 'selling-55-plus', title: 'Selling a 55+ Community Home', intent: 'Marketing to the right buyer' },
];

const RESOURCES = [
  { slug: 'mortgage-calculator', title: 'Tampa Mortgage Calculator', desc: 'Monthly payment + amortization' },
  { slug: 'home-value-estimator', title: 'What\'s My Tampa Home Worth?', desc: 'Get a free CMA' },
  { slug: 'affordability-calculator', title: 'How Much Home Can I Afford?', desc: 'Income-based affordability' },
  { slug: 'closing-cost-estimator', title: 'Tampa Closing Cost Calculator', desc: 'Buyer + seller estimates' },
  { slug: 'property-search', title: 'Search Tampa Bay Homes', desc: 'MLS-powered search' },
  { slug: 'school-district-finder', title: 'Tampa Bay School District Finder', desc: 'Find homes by school zone' },
  { slug: 'neighborhood-finder', title: 'Find Your Tampa Bay Neighborhood', desc: 'Match neighborhoods to your needs' },
  { slug: 'lender-directory', title: 'Tampa Bay Mortgage Lender Directory', desc: 'Trusted lenders Melissa works with' },
  { slug: 'inspector-directory', title: 'Tampa Bay Home Inspector Directory', desc: 'Vetted inspectors by area' },
  { slug: 'title-company-directory', title: 'Tampa Bay Title Companies', desc: 'Closing professionals' },
];

const FAQS = [
  { slug: 'how-long-to-buy', q: 'How long does it take to buy a home in Tampa Bay?' },
  { slug: 'how-much-down-payment', q: 'How much do I need for a down payment in Tampa?' },
  { slug: 'credit-score-needed', q: 'What credit score do I need to buy a home in Florida?' },
  { slug: 'how-long-to-sell', q: 'How long does it take to sell a home in Tampa Bay?' },
  { slug: 'whats-my-home-worth', q: 'How do I find out what my home is worth?' },
  { slug: 'rent-vs-buy-tampa', q: 'Should I rent or buy in Tampa Bay?' },
  { slug: 'choosing-a-realtor', q: 'How do I choose a real estate agent in Tampa?' },
  { slug: 'what-are-closing-costs', q: 'What are closing costs in Florida?' },
  { slug: 'whats-negotiable', q: 'What\'s actually negotiable in a real estate transaction?' },
  { slug: 'how-to-get-preapproved', q: 'How do I get pre-approved for a mortgage in Florida?' },
];

const MARKET_REPORTS = [
  { slug: 'tampa-bay-market-june-2026', title: 'Tampa Bay Real Estate Market Report — June 2026' },
  { slug: 'tampa-luxury-market', title: 'Tampa Luxury Market Trends 2026' },
  { slug: 'tampa-investment-property-trends', title: 'Tampa Investment Property Trends' },
  { slug: 'tampa-relocation-report', title: 'Why People Are Relocating to Tampa Bay' },
  { slug: 'tampa-school-district-rankings', title: 'Tampa Bay School District Rankings' },
];

const PROCESS_PAGES = [
  { slug: 'the-buying-process', title: 'The Tampa Bay Home Buying Process Step-by-Step' },
  { slug: 'the-selling-process', title: 'The Tampa Bay Home Selling Process Step-by-Step' },
  { slug: 'the-closing-process', title: 'What Happens at Closing in Florida' },
  { slug: 'mortgage-process', title: 'The Mortgage Process for Tampa Bay Buyers' },
];

const COMMUNITY_PAGES = [
  { slug: 'tampa-bay-schools', title: 'Tampa Bay School Guide for Homebuyers' },
  { slug: 'tampa-bay-parks', title: 'Tampa Bay Parks + Outdoor Living' },
  { slug: 'tampa-bay-restaurants', title: 'Tampa Bay Restaurant Guide for New Residents' },
  { slug: 'tampa-bay-beaches', title: 'Tampa Bay Beach Guide' },
  { slug: 'tampa-bay-events', title: 'Tampa Bay Events + Things to Do' },
];

const TESTIMONIAL_PAGES = [
  { slug: 'testimonials', title: 'What Melissa\'s Clients Say' },
  { slug: 'first-time-buyer-stories', title: 'First-Time Buyer Success Stories' },
  { slug: 'seller-success-stories', title: 'Seller Success Stories' },
  { slug: 'relocation-stories', title: 'Relocation Success Stories' },
  { slug: 'investor-success-stories', title: 'Investor + Investment Property Stories' },
];

// ── Layout helpers ─────────────────────────────────────────────────

function head(opts) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} | Melissa Wood, Tampa Bay Realtor</title>
<meta name="description" content="${escapeHtml(opts.desc)}">
<meta property="og:title" content="${escapeHtml(opts.title)} | Melissa Wood">
<meta property="og:description" content="${escapeHtml(opts.desc)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${IMAGES.hero}">
<meta name="theme-color" content="#0a2540">
<link rel="canonical" href="https://${AGENT.domain}/${opts.path || ''}">
<link rel="stylesheet" href="${BASE}/site.css">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "RealEstateAgent",
  "name": "${AGENT.name}",
  "telephone": "${AGENT.phone}",
  "email": "${AGENT.email}",
  "memberOf": {"@type":"Organization","name":"${AGENT.brokerage}"},
  "areaServed": "${AGENT.serviceArea}"
}
</script>
</head><body>`;
}

function header() {
  return `<header class="site-header"><div class="container">
<a class="brand" href="${BASE}/">
  <img class="brand-logo" src="${AGENT.logoMelissa}" alt="${AGENT.name}" onerror="this.style.display='none'">
  <div class="brand-text">
    <span class="brand-name">${AGENT.name}</span>
    <span class="brand-sub">${AGENT.brokerage}</span>
  </div>
</a>
<nav class="nav">
<a href="${BASE}/about.html">About</a>
<a href="${BASE}/buy.html">Buy</a>
<a href="${BASE}/sell.html">Sell</a>
<a href="${BASE}/listings.html">Listings</a>
<a href="${BASE}/neighborhoods.html">Neighborhoods</a>
<a href="${BASE}/resources.html">Resources</a>
<a href="${BASE}/contact.html" class="nav-cta">Contact</a>
</nav>
</div></header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="container">
<div class="footer-grid">
<div>
<div class="ft-name">${AGENT.name}</div>
<div class="ft-broker">${AGENT.brokerage}</div>
<div class="ft-contact"><a href="${AGENT.phoneHref}">${AGENT.phone}</a></div>
<div class="ft-contact"><a href="${AGENT.emailHref}">${AGENT.email}</a></div>
<div class="ft-logos">
  <img class="ft-logo-broker" src="${AGENT.logoBrokerage}" alt="${AGENT.brokerage}" onerror="this.style.display='none'">
</div>
</div>
<div>
<div class="ft-title">Neighborhoods</div>
${NEIGHBORHOODS.slice(0, 8).map(n => `<a href="${BASE}/neighborhoods/${n.slug}.html">${n.name}</a>`).join('')}
</div>
<div>
<div class="ft-title">Buying</div>
${BUYER_GUIDES.slice(0, 6).map(g => `<a href="${BASE}/buying/${g.slug}.html">${escapeHtml(g.title.split(':')[0].replace(' for Tampa Bay','').replace(' Tampa Bay','').replace(' in Tampa Bay',''))}</a>`).join('')}
</div>
<div>
<div class="ft-title">Selling</div>
${SELLER_GUIDES.slice(0, 6).map(g => `<a href="${BASE}/selling/${g.slug}.html">${escapeHtml(g.title.split(':')[0].replace(' for Tampa Bay Sellers','').replace(' Tampa Bay','').replace(' in Tampa Bay',''))}</a>`).join('')}
</div>
</div>
<div class="ft-bottom">© ${new Date().getFullYear()} ${AGENT.name} · ${AGENT.brokerage} · Licensed Real Estate Agent in Florida · Equal Housing Opportunity</div>
</div></footer>`;
}

function leadForm(headline, sub) {
  return `<section class="lead-block"><div class="container">
<div class="lead-card">
<div class="lead-text">
<div class="lead-eyebrow">Talk to ${AGENT.firstName}</div>
<div class="lead-headline">${escapeHtml(headline)}</div>
<div class="lead-sub">${escapeHtml(sub)}</div>
</div>
<form class="lead-form" action="${AGENT.emailHref}" method="GET">
<input type="text" name="name" placeholder="Your name" required>
<input type="tel" name="phone" placeholder="Phone">
<input type="email" name="email" placeholder="Email" required>
<button type="submit">Send →</button>
</form>
</div>
</div></section>`;
}

function ctaStrip() {
  return `<section class="cta-strip"><div class="container">
<div class="cta-text">Ready to talk? Call or text ${AGENT.firstName} directly.</div>
<div class="cta-buttons">
<a class="btn-primary" href="${AGENT.phoneHref}">${AGENT.phone}</a>
<a class="btn-secondary" href="${AGENT.emailHref}">Email ${AGENT.firstName}</a>
</div>
</div></section>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function wrap(opts, bodyHtml) {
  return head(opts) + header() + bodyHtml + ctaStrip() + footer() + '</body></html>';
}

function write(filename, content) {
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filename, content);
}

// ── Page generators ───────────────────────────────────────────────

function homePage() {
  const html = `
<section class="hero">
<div class="hero-bg"></div>
<div class="container">
<div class="hero-content">
<div class="hero-eyebrow">Tampa Bay Real Estate · ${AGENT.brokerage}</div>
<h1>She sells faster<br>than the rest<br><span class="hero-accent">of Tampa Bay.</span></h1>
<p class="hero-lede">Melissa guarantees nothing — but she will sell your damn house.</p>
<p class="hero-bold">Honest pricing. Faster closings. Smarter commissions. Real local knowledge from Brandon to Wesley Chapel, South Tampa to Ruskin.</p>
<div class="hero-cta">
<a class="btn-primary lg" href="${AGENT.phoneHref}">📞 Call ${AGENT.firstName}: ${AGENT.phone}</a>
<a class="btn-secondary lg" href="${BASE}/home-value-estimator.html">What's my home worth?</a>
</div>
<div class="hero-trust">
<div class="trust-item"><b>Licensed FL Realtor</b><span>${AGENT.brokerage}</span></div>
<div class="trust-item"><b>100-mile Tampa Bay radius</b><span>Tampa · Brandon · Valrico · Wesley Chapel · Ruskin · Apollo Beach</span></div>
<div class="trust-item"><b>Full-service representation</b><span>Buyers · sellers · investors · relocations</span></div>
</div>
</div>
</div>
</section>

<section class="stats"><div class="container">
<div class="stats-grid">
<div class="stat">
<div class="stat-num">&lt;21</div>
<div class="stat-label">Avg Days on Market</div>
<div class="stat-sub">Tampa Bay's faster-moving listings</div>
</div>
<div class="stat">
<div class="stat-num">100mi</div>
<div class="stat-label">Service Radius</div>
<div class="stat-sub">From Tampa Bay to the Gulf</div>
</div>
<div class="stat">
<div class="stat-num">24+</div>
<div class="stat-label">Neighborhoods Covered</div>
<div class="stat-sub">Deep local knowledge</div>
</div>
<div class="stat">
<div class="stat-num">100%</div>
<div class="stat-label">Honest Representation</div>
<div class="stat-sub">No fluff. No high-pressure.</div>
</div>
</div>
</div></section>

<section class="why"><div class="container">
<div class="why-eyebrow">Why Melissa</div>
<h2>She guarantees nothing — but she will sell your damn house.</h2>
<p class="why-tagline">No tricks. No agency pitches. Just honest real estate work in Tampa Bay, done right, from offer to close.</p>
<div class="why-grid">
<div class="why-card">
<div class="why-card-title">She tells you the truth.</div>
<div class="why-card-body">When a house is overpriced, she'll say so. When your list price is wrong, she'll fix it. When a deal isn't right, she'll walk you away from it. The job isn't to win the listing — it's to do right by you.</div>
</div>
<div class="why-card">
<div class="why-card-title">She knows every neighborhood.</div>
<div class="why-card-body">From Bayshore Boulevard to FishHawk Ranch, from South Tampa to Apollo Beach — Melissa knows which subdivisions hold value, which streets flood, which schools are A-rated, which HOAs actually matter. Generic comps lie; neighborhood-specific knowledge wins.</div>
</div>
<div class="why-card">
<div class="why-card-title">She moves fast.</div>
<div class="why-card-body">Tampa Bay is a fast-moving market. The agent who returns calls in 30 minutes wins offers the others lose. Melissa works personally with every client — no team layer, no auto-responders, no missed messages.</div>
</div>
<div class="why-card">
<div class="why-card-title">Smart commissions, full service.</div>
<div class="why-card-body">Commission isn't a number — it's a value question. Melissa offers competitive structures backed by full-service representation: pre-listing prep, professional photography, marketing strategy, negotiation, and closing coordination. You get the work, not just the sign in the yard.</div>
</div>
</div>
</div></section>

<section class="quote"><div class="quote-block">
<div class="quote-mark">"</div>
<div class="quote-body">I won't promise you anything I can't deliver. What I will do is work harder, communicate clearer, and tell you the truth about your home, your market, and your deal — every single time.</div>
<div class="quote-attr">— ${AGENT.name}, ${AGENT.brokerage}</div>
</div></section>

<section class="section"><div class="container">
<div class="section-eyebrow">Where Melissa Works</div>
<h2>Tampa Bay neighborhoods she knows inside and out</h2>
<p class="section-lede">From Bayshore's historic streets to Wesley Chapel's master-planned communities, ${AGENT.firstName} covers a 100-mile radius of Tampa Bay. Deep guides for every neighborhood she serves.</p>
<div class="photo-grid">
${NEIGHBORHOODS.slice(0, 8).map(n => `
<a class="photo-card" href="${BASE}/neighborhoods/${n.slug}.html">
<div class="img" style="background-image:url('${n.img}')"></div>
<div class="body">
<div class="photo-card-title">${escapeHtml(n.name)}</div>
<div class="photo-card-sub">${escapeHtml(n.tag)}</div>
</div>
</a>`).join('')}
</div>
<div class="section-link"><a href="${BASE}/neighborhoods.html">View all ${NEIGHBORHOODS.length} neighborhoods →</a></div>
</div></section>

<section class="section alt"><div class="container">
<div class="section-eyebrow">For Buyers</div>
<h2>Buying a home in Tampa Bay?</h2>
<p class="section-lede">From your first home to your fifth, Melissa walks you through it step by step. Honest market analysis. Vetted lender + inspector referrals. Custom MLS search that emails you matching listings the moment they hit.</p>
<div class="grid-cards">
${BUYER_GUIDES.slice(0, 6).map(g => `
<a class="card" href="${BASE}/buying/${g.slug}.html">
<div class="card-title">${escapeHtml(g.title)}</div>
<div class="card-sub">${escapeHtml(g.intent)}</div>
</a>`).join('')}
</div>
<div class="section-link"><a href="${BASE}/buy.html">All buyer resources →</a></div>
</div></section>

<section class="section"><div class="container">
<div class="section-eyebrow">For Sellers</div>
<h2>Selling your Tampa Bay home?</h2>
<p class="section-lede">Pricing it right matters more than ever. Melissa's pre-listing prep, professional photography, and pricing strategy gets homes sold — often above asking, even in shifting markets. No false promises. Just the work.</p>
<div class="grid-cards">
${SELLER_GUIDES.slice(0, 6).map(g => `
<a class="card" href="${BASE}/selling/${g.slug}.html">
<div class="card-title">${escapeHtml(g.title)}</div>
<div class="card-sub">${escapeHtml(g.intent)}</div>
</a>`).join('')}
</div>
<div class="section-link"><a href="${BASE}/sell.html">All seller resources →</a></div>
</div></section>

${leadForm(`Get in touch with ${AGENT.firstName}`, 'Buying, selling, or just exploring — let\'s talk. No high-pressure pitch. Just honest answers.')}
`;
  write('index.html', wrap({ title: 'Tampa Bay Real Estate — She Will Sell Your Damn House', desc: `${AGENT.name} is a Tampa Bay Realtor with ${AGENT.brokerage}. Faster closings. Honest representation. 100-mile radius of Tampa Bay. Call ${AGENT.phone}.`, path: '' }, html));
}

function aboutPage() {
  const html = `
<section class="page-hero"><div class="container">
<h1>About ${AGENT.name}</h1>
<p class="page-lede">Tampa Bay Realtor · ${AGENT.brokerage}</p>
</div></section>
<section class="section narrow"><div class="container">
<p>I'm Melissa Wood, a licensed Florida real estate agent with ${AGENT.brokerage}. I help buyers and sellers across Tampa Bay — from Brandon and Valrico east of town, north to Wesley Chapel and Lutz, west through South Tampa and Westchase, and south to Apollo Beach, Riverview, and Ruskin.</p>

<h2>What I do differently</h2>
<p>Most agents treat your transaction like a checklist. I treat it like a major life decision — because that's what it is. Whether you're buying your first home, selling the one you raised your kids in, or building a rental portfolio, you deserve someone who tells you the truth about the market, the property, and the deal.</p>

<h2>I won't promise what I can't deliver</h2>
<p>I don't guarantee a sale price. I don't guarantee a timeline. I don't guarantee an offer. What I DO guarantee: I'll outwork the agents you've talked to before. I'll communicate clearer. I'll return your calls in 30 minutes, not 30 hours. I'll tell you when a house is overpriced, when an offer is wrong, when your strategy needs to change. That's the real job.</p>

<h2>Areas I serve</h2>
<p>My service area covers a roughly 100-mile radius of Tampa Bay. That means I know the difference between an A-rated school zone in Wesley Chapel and a B-rated one a mile away. I know which Apollo Beach canals have deep water access and which don't. I know which Brandon subdivisions are gated, which have HOA fees that matter, and which are perfectly fine without one.</p>

<h2>Contact me directly</h2>
<p>The fastest way to reach me is by phone or text at <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a>. You can also email <a href="${AGENT.emailHref}">${AGENT.email}</a>. I respond personally — no team layer, no auto-responders.</p>
</div></section>
${leadForm('Want to chat?', `Send your info and ${AGENT.firstName} will call you back personally.`)}
`;
  write('about.html', wrap({ title: `About ${AGENT.name}`, desc: `${AGENT.name} is a Tampa Bay real estate agent with ${AGENT.brokerage}. Honest advice, deep local knowledge, and personal attention from offer to close.`, path: 'about.html' }, html));
}

function buyPage() {
  const html = `
<section class="page-hero"><div class="container">
<h1>Buying a Home in Tampa Bay</h1>
<p class="page-lede">Everything you need to know, from pre-approval to closing day.</p>
</div></section>
<section class="section"><div class="container">
<div class="section-eyebrow">Buyer Guides</div>
<h2>Start here</h2>
<div class="grid-cards">
${BUYER_GUIDES.map(g => `
<a class="card" href="${BASE}/buying/${g.slug}.html">
<div class="card-title">${escapeHtml(g.title)}</div>
<div class="card-sub">${escapeHtml(g.intent)}</div>
</a>`).join('')}
</div>
</div></section>
${leadForm('Ready to start your search?', `Tell ${AGENT.firstName} what you're looking for and she'll send you matching listings.`)}
`;
  write('buy.html', wrap({ title: 'Buying a Home in Tampa Bay', desc: 'Complete guides for Tampa Bay homebuyers — first-time buyer, relocation, investment property, waterfront, 55+, and more.', path: 'buy.html' }, html));
}

function sellPage() {
  const html = `
<section class="page-hero"><div class="container">
<h1>Selling Your Tampa Bay Home</h1>
<p class="page-lede">Pricing, prep, marketing, and negotiation — done right.</p>
</div></section>
<section class="section"><div class="container">
<div class="section-eyebrow">Seller Guides</div>
<h2>Start here</h2>
<div class="grid-cards">
${SELLER_GUIDES.map(g => `
<a class="card" href="${BASE}/selling/${g.slug}.html">
<div class="card-title">${escapeHtml(g.title)}</div>
<div class="card-sub">${escapeHtml(g.intent)}</div>
</a>`).join('')}
</div>
</div></section>
${leadForm('Get a free home valuation', `${AGENT.firstName} will pull recent comps and send you a realistic price range — no obligation.`)}
`;
  write('sell.html', wrap({ title: 'Selling Your Tampa Bay Home', desc: 'Tampa Bay seller resources — pricing strategy, staging, marketing, negotiation, and closing.', path: 'sell.html' }, html));
}

function listingsPage() {
  const html = `
<section class="page-hero"><div class="container">
<h1>Current Tampa Bay Listings</h1>
<p class="page-lede">Search the full Tampa Bay MLS — updated in real time.</p>
</div></section>
<section class="section narrow"><div class="container">
<div class="callout">
<b>MLS search coming soon.</b> Until the IDX feed is live, send ${AGENT.firstName} your search criteria — neighborhoods, price range, beds/baths, must-haves — and she'll set up a custom search that emails you matching listings the moment they hit the market.
</div>
<div class="cta-buttons" style="margin-top:28px;justify-content:flex-start">
<a class="btn-primary" href="${AGENT.phoneHref}">${AGENT.phone}</a>
<a class="btn-secondary" href="${AGENT.emailHref}" style="color:var(--navy);border-color:var(--navy)">Email Search Criteria</a>
</div>
</div></section>
${leadForm('Build your custom Tampa Bay home search', `${AGENT.firstName} will set you up with personalized email alerts for matching listings.`)}
`;
  write('listings.html', wrap({ title: 'Tampa Bay Listings', desc: 'Search current Tampa Bay homes for sale — Tampa, Brandon, Valrico, Wesley Chapel, Apollo Beach, Riverview, and more.', path: 'listings.html' }, html));
}

function contactPage() {
  const html = `
<section class="page-hero"><div class="container">
<h1>Contact ${AGENT.firstName}</h1>
<p class="page-lede">Call, text, or email — ${AGENT.firstName} responds personally.</p>
</div></section>
<section class="section narrow"><div class="container">
<div class="contact-grid">
<div>
<h2>Direct contact</h2>
<p><b>Phone / text:</b> <a href="${AGENT.phoneHref}">${AGENT.phone}</a></p>
<p><b>Email:</b> <a href="${AGENT.emailHref}">${AGENT.email}</a></p>
<p><b>Brokerage:</b> ${AGENT.brokerage}</p>
<p><b>Service area:</b> Tampa Bay — 100-mile radius including Tampa, Brandon, Valrico, Wesley Chapel, Ruskin, Apollo Beach, Riverview, FishHawk, and beyond.</p>
</div>
<div>
<h2>Send a message</h2>
<form class="lead-form vertical" action="${AGENT.emailHref}" method="GET">
<input type="text" name="name" placeholder="Your name" required>
<input type="tel" name="phone" placeholder="Phone">
<input type="email" name="email" placeholder="Email" required>
<textarea name="message" placeholder="Tell ${AGENT.firstName} what you're looking for..." rows="5"></textarea>
<button type="submit">Send to ${AGENT.firstName}</button>
</form>
</div>
</div>
</div></section>
`;
  write('contact.html', wrap({ title: `Contact ${AGENT.name}`, desc: `Reach Tampa Bay Realtor ${AGENT.name} directly. Call ${AGENT.phone} or email ${AGENT.email}.`, path: 'contact.html' }, html));
}

function neighborhoodsIndex() {
  const html = `
<section class="page-hero"><div class="container">
<h1>Tampa Bay Neighborhoods</h1>
<p class="page-lede">All ${NEIGHBORHOODS.length} neighborhoods ${AGENT.firstName} actively serves — deep guides for each.</p>
</div></section>
<section class="section"><div class="container">
<div class="photo-grid">
${NEIGHBORHOODS.map(n => `
<a class="photo-card" href="${BASE}/neighborhoods/${n.slug}.html">
<div class="img" style="background-image:url('${n.img}')"></div>
<div class="body">
<div class="photo-card-title">${escapeHtml(n.name)}</div>
<div class="photo-card-sub">${escapeHtml(n.tag)}</div>
</div>
</a>`).join('')}
</div>
</div></section>
${leadForm('Not sure which neighborhood is right?', `${AGENT.firstName} will help you match neighborhoods to your lifestyle, commute, and budget.`)}
`;
  write('neighborhoods.html', wrap({ title: 'Tampa Bay Neighborhoods', desc: `Detailed guides to ${NEIGHBORHOODS.length} Tampa Bay neighborhoods including Tampa, Brandon, Valrico, Wesley Chapel, Apollo Beach, Ruskin, FishHawk, and more.`, path: 'neighborhoods.html' }, html));
}

function neighborhoodPage(n) {
  const html = `
<section class="page-hero" style="background-image:url('${n.img}');background-size:cover;background-position:center"><div class="container">
<div class="breadcrumb"><a href="${BASE}/neighborhoods.html">All Neighborhoods</a> · ${escapeHtml(n.name)}</div>
<h1>${escapeHtml(n.name)} Real Estate</h1>
<p class="page-lede">${escapeHtml(n.tag)}</p>
</div></section>
<section class="section narrow"><div class="container">
<h2>About ${escapeHtml(n.name)}</h2>
<p>${escapeHtml(n.name)} is one of Tampa Bay's distinctive neighborhoods. Whether you're buying your first home here, moving up, or looking for an investment property, ${AGENT.name} knows ${escapeHtml(n.name)} street by street — which subdivisions hold value, which streets flood, which builders deliver, which HOAs are reasonable.</p>

<h2>What makes ${escapeHtml(n.name)} special</h2>
<ul class="feature-list">
${n.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
</ul>

<h2>Buying in ${escapeHtml(n.name)}</h2>
<p>When you're shopping in ${escapeHtml(n.name)}, you want a Realtor who has actually walked the streets, sat at the closings, and knows which homes have hidden issues. ${AGENT.firstName} has helped buyers in ${escapeHtml(n.name)} navigate everything from new construction punch lists to negotiating inspection responses on older homes. Call her at <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a> to talk about your search.</p>

<h2>Selling in ${escapeHtml(n.name)}</h2>
<p>Pricing in ${escapeHtml(n.name)} requires neighborhood-level knowledge. Comps from a mile away can lead you astray. ${AGENT.firstName} pulls true-comparable listings, walks your property in person, and gives you a realistic price range — not the optimistic number some agents use to win the listing. Get a real ${escapeHtml(n.name)} home valuation by calling <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a>.</p>

<h2>Schools, commutes, and lifestyle</h2>
<p>School zones, commute times, grocery options, parks, walkability — these are the things that determine whether ${escapeHtml(n.name)} is the right neighborhood for YOU specifically. ${AGENT.firstName} will tell you straight up whether ${escapeHtml(n.name)} fits your situation or whether a nearby neighborhood would serve you better.</p>

<h2>Talk to a real ${escapeHtml(n.name)} Realtor</h2>
<p>Don't trust your home purchase or sale to a Zillow lead-gen agent who lives 20 miles away. Call ${AGENT.firstName} directly at <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a> or email <a href="${AGENT.emailHref}">${AGENT.email}</a>.</p>
</div></section>
${leadForm(`Interested in ${n.name}?`, `${AGENT.firstName} will share off-market opportunities, accurate comps, and her honest take on the neighborhood.`)}
`;
  write(`neighborhoods/${n.slug}.html`, wrap({ title: `${n.name} Real Estate`, desc: `${n.name} homes for sale + neighborhood guide by Tampa Bay Realtor ${AGENT.name}. ${n.tag}. Call ${AGENT.phone}.`, path: `neighborhoods/${n.slug}.html` }, html));
}

function guidePage(g, type) {
  const dir = type === 'buyer' ? 'buying' : 'selling';
  const html = `
<section class="page-hero"><div class="container">
<div class="breadcrumb"><a href="${BASE}/${type === 'buyer' ? 'buy' : 'sell'}.html">All ${type === 'buyer' ? 'Buyer' : 'Seller'} Guides</a></div>
<h1>${escapeHtml(g.title)}</h1>
<p class="page-lede">${escapeHtml(g.intent)}</p>
</div></section>
<section class="section narrow"><div class="container">
<h2>What you'll learn</h2>
<p>This guide covers everything Tampa Bay ${type === 'buyer' ? 'buyers' : 'sellers'} need to know about ${escapeHtml(g.intent.toLowerCase())} — from the first conversation to the closing table. Whether you're new to the area or you've been here for decades, the Tampa Bay market has unique factors that make working with a local Realtor critical.</p>

<h2>The Tampa Bay context</h2>
<p>${escapeHtml(g.intent)} in Tampa Bay specifically means understanding factors that don't apply in other markets: hurricane insurance requirements, flood zones (AE vs X), wind mitigation credits, HOA structures, retirement-friendly tax considerations, and seasonal market patterns. ${AGENT.name} has worked through all of these with clients across the Tampa Bay region.</p>

<h2>How ${AGENT.firstName} can help</h2>
<p>${AGENT.name} provides full-service representation backed by ${AGENT.brokerage}. That means:</p>
<ul class="feature-list">
<li>Personal attention from a real Realtor — not a team layer or junior agent</li>
<li>Honest market analysis using local comps</li>
<li>Vetted lender, inspector, and title company referrals</li>
<li>${type === 'buyer' ? 'Custom MLS search alerts that match what you\'re actually looking for' : 'Pre-listing prep checklist + professional photography + marketing strategy'}</li>
<li>${type === 'buyer' ? 'Negotiation on price, inspection responses, repairs, and credits' : 'Negotiation on offer terms, contingencies, and closing'}</li>
<li>Coordination from contract through closing</li>
</ul>

<h2>Next step</h2>
<p>The best first move is a quick phone call. Tell ${AGENT.firstName} your situation, your timeline, and what's most important to you. She'll tell you honestly whether the timing makes sense and what realistic next steps look like. Call <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a> or email <a href="${AGENT.emailHref}">${AGENT.email}</a>.</p>
</div></section>
${leadForm(`Questions about ${g.intent.toLowerCase()}?`, `${AGENT.firstName} will give you a straight answer + a clear next step.`)}
`;
  write(`${dir}/${g.slug}.html`, wrap({ title: g.title, desc: `${g.title} — practical guide from Tampa Bay Realtor ${AGENT.name}. Call ${AGENT.phone} for honest, local expertise.`, path: `${dir}/${g.slug}.html` }, html));
}

function resourceIndex() {
  const html = `
<section class="page-hero"><div class="container">
<h1>Tampa Bay Real Estate Resources</h1>
<p class="page-lede">Calculators, directories, and tools ${AGENT.firstName}'s clients use.</p>
</div></section>
<section class="section"><div class="container">
<div class="section-eyebrow">Tools</div>
<div class="grid-cards">
${RESOURCES.map(r => `
<a class="card" href="${BASE}/resources/${r.slug}.html">
<div class="card-title">${escapeHtml(r.title)}</div>
<div class="card-sub">${escapeHtml(r.desc)}</div>
</a>`).join('')}
</div>
<h2 style="margin-top:64px">Process guides</h2>
<div class="grid-cards">
${PROCESS_PAGES.map(p => `
<a class="card" href="${BASE}/resources/${p.slug}.html">
<div class="card-title">${escapeHtml(p.title)}</div>
</a>`).join('')}
</div>
<h2 style="margin-top:64px">Community + lifestyle</h2>
<div class="grid-cards">
${COMMUNITY_PAGES.map(c => `
<a class="card" href="${BASE}/resources/${c.slug}.html">
<div class="card-title">${escapeHtml(c.title)}</div>
</a>`).join('')}
</div>
</div></section>
`;
  write('resources.html', wrap({ title: 'Tampa Bay Real Estate Resources', desc: `Free Tampa Bay real estate tools — mortgage calculator, home value estimator, school district finder, and more from Realtor ${AGENT.name}.`, path: 'resources.html' }, html));
}

function resourcePage(r) {
  const html = `
<section class="page-hero"><div class="container">
<div class="breadcrumb"><a href="${BASE}/resources.html">Resources</a></div>
<h1>${escapeHtml(r.title)}</h1>
<p class="page-lede">${escapeHtml(r.desc || '')}</p>
</div></section>
<section class="section narrow"><div class="container">
<div class="callout">
<b>Talk to ${AGENT.firstName}.</b> For a personalized version of this resource based on your specific situation, neighborhood, and budget — call <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a> or email <a href="${AGENT.emailHref}">${AGENT.email}</a>. Free, no obligation, no spam.
</div>

<h2>Why this matters</h2>
<p>This tool helps Tampa Bay buyers and sellers get oriented before they start working with a Realtor. The numbers and information here are guidelines based on Tampa Bay market data — your specific situation may vary, which is why personal consultation matters.</p>

<h2>How to use it</h2>
<p>Walk through the questions or fields with realistic numbers. The output gives you a starting point, not a final answer. Bring the result to your conversation with ${AGENT.firstName}, who'll refine it based on your specific neighborhood, property, and goals.</p>

<h2>Next step</h2>
<p>When you're ready to talk through your specific situation with a local Tampa Bay Realtor who'll tell you the truth, call ${AGENT.name} at <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a>.</p>
</div></section>
${leadForm('Get personalized numbers', `Send ${AGENT.firstName} your situation and she'll come back with realistic local estimates.`)}
`;
  write(`resources/${r.slug}.html`, wrap({ title: r.title, desc: `${r.title} — free Tampa Bay real estate tool from ${AGENT.name}, ${AGENT.brokerage}.`, path: `resources/${r.slug}.html` }, html));
}

function faqIndex() {
  const html = `
<section class="page-hero"><div class="container">
<h1>Tampa Bay Real Estate FAQs</h1>
<p class="page-lede">The questions ${AGENT.firstName} hears most often, answered honestly.</p>
</div></section>
<section class="section"><div class="container">
<div class="grid-cards">
${FAQS.map(f => `
<a class="card" href="${BASE}/faq/${f.slug}.html">
<div class="card-title">${escapeHtml(f.q)}</div>
</a>`).join('')}
</div>
</div></section>
`;
  write('faq.html', wrap({ title: 'Tampa Bay Real Estate FAQs', desc: 'Common questions Tampa Bay buyers and sellers ask, answered honestly by Realtor Melissa Wood.', path: 'faq.html' }, html));
}

function faqPage(f) {
  const html = `
<section class="page-hero"><div class="container">
<div class="breadcrumb"><a href="${BASE}/faq.html">FAQs</a></div>
<h1>${escapeHtml(f.q)}</h1>
</div></section>
<section class="section narrow"><div class="container">
<h2>The short answer</h2>
<p>Every situation is different, but here's the honest, practical version of what most Tampa Bay clients in this situation need to know.</p>

<h2>The Tampa Bay context</h2>
<p>What's true for Tampa Bay specifically: hurricane season, insurance considerations, flood zones, HOA requirements, and the unique mix of retirees, military families, and relocations from other states make this market different from national averages. Generic answers from national real estate sites can lead you astray.</p>

<h2>What ${AGENT.firstName} recommends</h2>
<p>The best move is a 10-minute phone call. Tell ${AGENT.firstName} your specific situation — your timeline, your budget, your goals — and she'll give you the realistic answer for YOUR scenario. Call <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a> or email <a href="${AGENT.emailHref}">${AGENT.email}</a>.</p>

<h2>Related questions</h2>
<div class="grid-cards">
${FAQS.filter(x => x.slug !== f.slug).slice(0, 4).map(x => `
<a class="card" href="${BASE}/faq/${x.slug}.html">
<div class="card-title">${escapeHtml(x.q)}</div>
</a>`).join('')}
</div>
</div></section>
${leadForm('Have a question?', `Ask ${AGENT.firstName} directly — no obligation, no high-pressure sales.`)}
`;
  write(`faq/${f.slug}.html`, wrap({ title: f.q, desc: `${f.q} — answered by Tampa Bay Realtor ${AGENT.name}. Call ${AGENT.phone} for personalized advice.`, path: `faq/${f.slug}.html` }, html));
}

function marketReportPage(m) {
  const html = `
<section class="page-hero"><div class="container">
<div class="breadcrumb"><a href="${BASE}/market-reports.html">Market Reports</a></div>
<h1>${escapeHtml(m.title)}</h1>
<p class="page-lede">Local, honest, current.</p>
</div></section>
<section class="section narrow"><div class="container">
<h2>What this report covers</h2>
<p>${AGENT.firstName} publishes Tampa Bay market reports based on local MLS data, not national headlines. National real estate news often misses what's actually happening in YOUR neighborhood — South Tampa moves differently than Wesley Chapel, Apollo Beach behaves differently than Brandon.</p>

<h2>The trends ${AGENT.firstName} is watching</h2>
<p>Days on market, list-to-sale ratios, price per square foot by neighborhood, inventory levels, and buyer competition levels. Each metric tells a different part of the story — together they paint the real picture of whether it's a buyer's market, a seller's market, or somewhere in between.</p>

<h2>Want the current data for YOUR neighborhood?</h2>
<p>Call ${AGENT.firstName} at <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a> or email <a href="${AGENT.emailHref}">${AGENT.email}</a>. She'll send you a custom market snapshot for the exact neighborhood and price range you care about — usually within 24 hours.</p>
</div></section>
${leadForm('Want a neighborhood-specific report?', `Tell ${AGENT.firstName} your area and she'll send a custom Tampa Bay market snapshot.`)}
`;
  write(`market-reports/${m.slug}.html`, wrap({ title: m.title, desc: `${m.title} from Tampa Bay Realtor ${AGENT.name}. Local market data and honest analysis.`, path: `market-reports/${m.slug}.html` }, html));
}

function marketReportsIndex() {
  const html = `
<section class="page-hero"><div class="container">
<h1>Tampa Bay Market Reports</h1>
<p class="page-lede">Local data, not national headlines.</p>
</div></section>
<section class="section"><div class="container">
<div class="grid-cards">
${MARKET_REPORTS.map(m => `
<a class="card" href="${BASE}/market-reports/${m.slug}.html">
<div class="card-title">${escapeHtml(m.title)}</div>
</a>`).join('')}
</div>
</div></section>
${leadForm('Want a custom market report?', `${AGENT.firstName} will send a neighborhood-specific snapshot for your area.`)}
`;
  write('market-reports.html', wrap({ title: 'Tampa Bay Market Reports', desc: 'Local Tampa Bay real estate market reports by Realtor Melissa Wood — monthly trends, neighborhood-level data.', path: 'market-reports.html' }, html));
}

function genericContent(item, prefix) {
  const html = `
<section class="page-hero"><div class="container">
<h1>${escapeHtml(item.title)}</h1>
</div></section>
<section class="section narrow"><div class="container">
<p>${AGENT.name} — Tampa Bay Realtor with ${AGENT.brokerage} — helps clients across the Tampa Bay region with everything from first homes to investment properties to relocations.</p>
<h2>How this applies to YOUR situation</h2>
<p>Every client is different. The general guidance here is a starting point — the right next step is a 10-minute conversation about your specific situation. Call ${AGENT.firstName} at <a href="${AGENT.phoneHref}"><b>${AGENT.phone}</b></a> or email <a href="${AGENT.emailHref}">${AGENT.email}</a>.</p>
<h2>Why work with ${AGENT.firstName}</h2>
<p>Honest advice. Personal attention — no team layer. Deep Tampa Bay knowledge from Brandon to Wesley Chapel, South Tampa to Apollo Beach. Full-service representation from offer to close, backed by ${AGENT.brokerage}.</p>
</div></section>
${leadForm(`Talk to ${AGENT.firstName}`, `Get personalized Tampa Bay real estate advice. Free, no obligation.`)}
`;
  write(`${prefix}/${item.slug}.html`, wrap({ title: item.title, desc: `${item.title} — Tampa Bay real estate insight from ${AGENT.name}, ${AGENT.brokerage}.`, path: `${prefix}/${item.slug}.html` }, html));
}

function sitemap() {
  const urls = [
    '', 'about.html', 'buy.html', 'sell.html', 'listings.html', 'contact.html',
    'neighborhoods.html', 'resources.html', 'faq.html', 'market-reports.html',
    ...NEIGHBORHOODS.map(n => `neighborhoods/${n.slug}.html`),
    ...BUYER_GUIDES.map(g => `buying/${g.slug}.html`),
    ...SELLER_GUIDES.map(g => `selling/${g.slug}.html`),
    ...RESOURCES.map(r => `resources/${r.slug}.html`),
    ...PROCESS_PAGES.map(p => `resources/${p.slug}.html`),
    ...COMMUNITY_PAGES.map(c => `resources/${c.slug}.html`),
    ...TESTIMONIAL_PAGES.map(t => `resources/${t.slug}.html`),
    ...FAQS.map(f => `faq/${f.slug}.html`),
    ...MARKET_REPORTS.map(m => `market-reports/${m.slug}.html`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `<url><loc>https://${AGENT.domain}/${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>`;
  write('sitemap.xml', xml);
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: https://${AGENT.domain}/sitemap.xml\n`);
}

// ── Run ───────────────────────────────────────────────────────────

homePage();
aboutPage();
buyPage();
sellPage();
listingsPage();
contactPage();
neighborhoodsIndex();
resourceIndex();
faqIndex();
marketReportsIndex();
NEIGHBORHOODS.forEach(n => neighborhoodPage(n));
BUYER_GUIDES.forEach(g => guidePage(g, 'buyer'));
SELLER_GUIDES.forEach(g => guidePage(g, 'seller'));
RESOURCES.forEach(r => resourcePage(r));
PROCESS_PAGES.forEach(p => genericContent(p, 'resources'));
COMMUNITY_PAGES.forEach(c => genericContent(c, 'resources'));
TESTIMONIAL_PAGES.forEach(t => genericContent(t, 'resources'));
FAQS.forEach(f => faqPage(f));
MARKET_REPORTS.forEach(m => marketReportPage(m));
sitemap();

const total = 10 + NEIGHBORHOODS.length + BUYER_GUIDES.length + SELLER_GUIDES.length + RESOURCES.length + PROCESS_PAGES.length + COMMUNITY_PAGES.length + TESTIMONIAL_PAGES.length + FAQS.length + MARKET_REPORTS.length;
console.log(`Generated ${total} pages.`);
