#!/usr/bin/env node
// Build all symptom, brand, hub, calculator, ant, and how-it-works pages.
// Idempotent — run anytime to regenerate from data files.

const fs = require("fs");
const path = require("path");
const symptoms = require("./symptoms-data.js");
const brands = require("./brands-data.js");
const tpl = require("./template.js");
const { SITE, ALL_CITIES } = require("./shared.js");
const { esc, buildHead, buildNav, buildFooter, schemaLocalBusiness, schemaService, schemaFAQ, schemaBreadcrumbs,
        renderTDRGrid, renderPricingBlock, renderRelated, renderCityTags, renderBrandLinks, ANT_CTA_TEXT } = tpl;

const OUT_DIR = path.resolve(__dirname, "../..");

function writeFile(slug, html) {
  const fp = path.join(OUT_DIR, `${slug}.html`);
  fs.writeFileSync(fp, html, "utf8");
  return fp;
}

// ===== Symptom page generator =====
function buildSymptomPage(s) {
  const crumbs = [
    { name: "Home", url: `${SITE}/` },
    { name: s.appliance.charAt(0).toUpperCase() + s.appliance.slice(1) + " Repair", url: `${SITE}/${s.appliance.split(" ")[0]}-repair` },
    { name: s.title, url: `${SITE}/${s.slug}` }
  ];
  const schemas = [
    schemaLocalBusiness(),
    schemaService(s.title + " Repair"),
    schemaFAQ(s.faqs),
    schemaBreadcrumbs(crumbs)
  ];

  const head = buildHead({
    slug: s.slug,
    title: s.title,
    metaTitle: s.metaTitle,
    metaDesc: s.metaDesc,
    keywords: s.keywords,
    schemas
  });

  const breadcrumbHtml = `<div class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/${s.appliance.split(" ")[0]}-repair">${esc(s.appliance.charAt(0).toUpperCase() + s.appliance.slice(1))} Repair</a><span>›</span>${esc(s.title)}</div>`;

  const causesHtml = s.causes.map(c => `<div class="cause"><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p></div>`).join("");
  const faqHtml = s.faqs.map(f => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join("");
  const relatedHtml = renderRelated(s.relatedSymptoms, symptoms);

  const body = `<body>
<div class="bg"><div class="bg-orb orb1"></div><div class="bg-orb orb2"></div></div>
<div class="shell">
${buildNav()}
<div class="hero">
${breadcrumbHtml}
<span class="hero-icon">${s.icon}</span>
<div class="hero-label">Symptom Diagnostic</div>
<h1>${esc(s.h1)}<em>Here's What's Actually Wrong</em></h1>
<p class="hero-sub">Save the guesswork. A real technician reviews your model number and a short video, then builds a <strong>Technician Decision Report</strong> with four honest options and real pricing. The $50 Quick Check fee becomes credit toward your repair if you proceed.</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Chat with Ant</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call 615-280-2949</a>
</div>
<div class="quick-answer"><p>${esc(s.quickAnswer)}</p></div>
</div>

<div class="content">

<div class="section">
<div class="section-label">What's Actually Happening</div>
<h2>The Most Common Causes</h2>
<p class="prose">These are the failure modes our technicians see most often on this symptom — listed in rough order of frequency. We don't publish step-by-step repair instructions for liability reasons, but the diagnostic process below identifies which one applies to your machine before any parts get swapped.</p>
<div class="cause-list">${causesHtml}</div>
</div>

<div class="section">
<div class="section-label">Is It Worth Fixing?</div>
<h2>The Honest Answer</h2>
<p class="prose">${esc(s.isItWorthFixing)} Parts availability and labor complexity matter more than the age of the machine. A well-built ten-year-old appliance with an available part is often worth fixing twice. A newer unit with a discontinued board is the harder call. Our techs lay both options out side-by-side — repair cost vs. replacement cost — and let you decide. <a href="/should-i-repair-or-replace">Try the replacement calculator</a> for a quick framing, but every situation is different.</p>
</div>

<div class="section">
<div class="section-label">How the TDR Works</div>
<h2>The 4-Option Technician Decision Report</h2>
<p class="prose">After your $50 Quick Check (or $100 in-home diagnostic), a real technician — not a chatbot — reviews your model, video, and symptoms. They build a Technician Decision Report with four honest options:</p>
${renderTDRGrid()}
<p class="prose" style="margin-top:18px">You pick which option works for you. <strong>No surprises, no hidden costs.</strong> We don't share specific part numbers — we source the parts ourselves and ship them directly to your door, so you never have to hunt for the right SKU.</p>
</div>

<div class="section">
<div class="section-label">Pricing</div>
<h2>Real Numbers, No Mystery</h2>
<p class="prose">Most repairs for this symptom land in the range below. The diagnostic confirms exactly which job it is before any quote — and the diagnostic fee credits toward your repair labor.</p>
${renderPricingBlock()}
</div>

<div class="section">
<div class="section-label">FAQ</div>
<h2>People Also Ask</h2>
<div class="faq">${faqHtml}</div>
</div>

<div class="section">
<div class="section-label">Related Symptoms</div>
<h2>Other Things That Could Be Wrong</h2>
<div class="related-grid">${relatedHtml}</div>
</div>

<div class="section">
<div class="section-label">Where We Service</div>
<h2>Middle TN + Louisiana</h2>
<p class="prose">Whether you're in Nashville or Hammond, the diagnostic process is the same. We service Middle Tennessee and Louisiana with six experienced technicians.</p>
<div class="cities-tag">${renderCityTags()}</div>
<p class="prose" style="margin-top:18px">Outside the cities listed? <a href="/#chat">Chat with Ant</a> — we'll confirm coverage before you pay anything.</p>
</div>

<div class="cta-section">
<div class="section-label">Get Started</div>
<h2>Chat with Ant — Get a Real Answer Today</h2>
<p>${esc(ANT_CTA_TEXT)}</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Start the Quick Check — $50</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call Instead</a>
</div>
</div>

</div>
${buildFooter()}
</div>
</body>
</html>`;

  return head + body;
}

// ===== Brand page generator =====
function buildBrandPage(b) {
  const crumbs = [
    { name: "Home", url: `${SITE}/` },
    { name: b.brand + " Repair", url: `${SITE}/${b.slug}` }
  ];
  const schemas = [
    schemaLocalBusiness(),
    schemaService(`${b.brand} ${b.scope === "all" ? "Appliance" : b.scope.charAt(0).toUpperCase() + b.scope.slice(1)} Repair`),
    schemaFAQ(b.faqs),
    schemaBreadcrumbs(crumbs)
  ];

  const head = buildHead({
    slug: b.slug,
    title: b.title,
    metaTitle: b.metaTitle,
    metaDesc: b.metaDesc,
    keywords: b.keywords,
    schemas
  });

  const issuesHtml = b.commonIssues.map(c => `<div class="cause"><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p></div>`).join("");
  const faqHtml = b.faqs.map(f => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join("");
  const relatedHtml = renderRelated(b.relatedSymptoms, symptoms);

  const scopeLabel = b.scope === "all" ? "All Appliances" :
    b.scope === "washer" ? "Washers" :
    b.scope === "dryer" ? "Dryers" :
    b.scope === "refrigerator" ? "Refrigerators" : "Appliances";

  const body = `<body>
<div class="bg"><div class="bg-orb orb1"></div><div class="bg-orb orb2"></div></div>
<div class="shell">
${buildNav()}
<div class="hero">
<div class="breadcrumb"><a href="/">Home</a><span>›</span>${esc(b.brand)} Repair</div>
<div class="hero-label">${esc(b.brand)} · ${esc(scopeLabel)}</div>
<h1>${esc(b.brand)}<em>${esc(b.scope === "all" ? "Appliance Repair" : (b.scope.charAt(0).toUpperCase() + b.scope.slice(1)) + " Repair")}</em></h1>
<p class="hero-sub">Honest, technician-led diagnosis on ${esc(b.brand)} ${esc(b.scope === "all" ? "appliances" : b.scope + "s")}. A real tech reviews your model and symptoms, then builds a <strong>Technician Decision Report</strong> with four options and real pricing. Diagnostic fee credits toward your repair.</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Chat with Ant</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call 615-280-2949</a>
</div>
<div class="quick-answer"><p>${esc(b.intro)}</p></div>
</div>

<div class="content">

<div class="section">
<div class="section-label">Common ${esc(b.brand)} Issues</div>
<h2>What We See Most Often</h2>
<p class="prose">${esc(b.brand)} ${esc(b.scope === "all" ? "appliances" : b.scope + "s")} have known failure patterns our techs have seen across hundreds of jobs. Knowing the platform's quirks means faster diagnosis and the right part the first time.</p>
<div class="cause-list">${issuesHtml}</div>
</div>

<div class="section">
<div class="section-label">Parts Availability</div>
<h2>What That Means for Repair Cost</h2>
<p class="prose">${esc(b.partsAvailability)} Parts availability is one of the biggest factors in repair-vs-replace decisions — and it's why the brand matters when you're deciding whether to fix a 10-year-old machine.</p>
</div>

<div class="section">
<div class="section-label">How the TDR Works</div>
<h2>The 4-Option Technician Decision Report</h2>
<p class="prose">For every ${esc(b.brand)} repair, a real technician reviews your model and symptoms, then gives you four options with real pricing. You pick.</p>
${renderTDRGrid()}
</div>

<div class="section">
<div class="section-label">Pricing</div>
<h2>Real Numbers, No Mystery</h2>
${renderPricingBlock()}
</div>

<div class="section">
<div class="section-label">FAQ</div>
<h2>${esc(b.brand)} Customers Ask</h2>
<div class="faq">${faqHtml}</div>
</div>

<div class="section">
<div class="section-label">Related Symptoms</div>
<h2>Common ${esc(b.brand)} Problems</h2>
<div class="related-grid">${relatedHtml}</div>
</div>

<div class="section">
<div class="section-label">Where We Service</div>
<h2>Middle TN + Louisiana</h2>
<p class="prose">We service all ${esc(b.brand)} ${esc(b.scope === "all" ? "appliances" : b.scope + "s")} across Middle Tennessee and Louisiana.</p>
<div class="cities-tag">${renderCityTags()}</div>
</div>

<div class="cta-section">
<div class="section-label">Get Started</div>
<h2>Chat with Ant About Your ${esc(b.brand)}</h2>
<p>${esc(ANT_CTA_TEXT)}</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Start the Quick Check — $50</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call Instead</a>
</div>
</div>

</div>
${buildFooter()}
</div>
</body>
</html>`;

  return head + body;
}

// ===== Hub page generator =====
function buildHubPage({ slug, appliance, title, h1, metaTitle, metaDesc, keywords, intro, icon }) {
  const symptomsFor = symptoms.filter(s => s.appliance === appliance);
  const brandsForAppliance = brands.filter(b => b.scope === appliance || b.scope === "all");

  const crumbs = [
    { name: "Home", url: `${SITE}/` },
    { name: title, url: `${SITE}/${slug}` }
  ];

  const hubFaqs = [
    { q: `How much does ${appliance} repair cost?`, a: `Most ${appliance} repairs land in the $150–$400 range. Diagnostic fees ($50 Quick Check or $100 in-home) credit directly toward repair labor, so you never pay for both separately.` },
    { q: `Is it worth repairing my ${appliance}?`, a: `In most cases yes — parts availability and labor complexity matter more than age. Older ${appliance}s are often well-built and absolutely worth fixing. Our technicians give you honest cost-of-repair vs. cost-of-replacement on every job.` },
    { q: `How fast can I get a ${appliance} diagnosis?`, a: `Chat with Ant any time — a real technician reviews your video and model number, usually within hours, and builds your Technician Decision Report with four options.` },
    { q: `Do I have to pay the diagnostic fee AND the repair cost?`, a: `No. Your $50 Quick Check or $100 in-home diagnostic applies directly to repair labor if you proceed. You pay once.` },
    { q: `What brands of ${appliance}s do you repair?`, a: `All major brands — Whirlpool, GE, Samsung, LG, Maytag, Frigidaire, Kenmore, Bosch, KitchenAid, Electrolux, Amana, and more.` }
  ];

  const schemas = [
    schemaLocalBusiness(),
    schemaService(`${appliance.charAt(0).toUpperCase() + appliance.slice(1)} Repair`),
    schemaFAQ(hubFaqs),
    schemaBreadcrumbs(crumbs)
  ];

  const head = buildHead({ slug, title, metaTitle, metaDesc, keywords, schemas });

  const symptomLinks = symptomsFor.map(s => `<a href="/${s.slug}" class="related-link">${esc(s.title)}</a>`).join("");

  const brandLinks = brandsForAppliance.slice(0, 8).map(b => {
    const label = b.brand;
    return `<a href="/${b.slug}" class="brand-link">${esc(label)}</a>`;
  }).join("");

  const faqHtml = hubFaqs.map(f => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join("");

  const body = `<body>
<div class="bg"><div class="bg-orb orb1"></div><div class="bg-orb orb2"></div></div>
<div class="shell">
${buildNav()}
<div class="hero">
<div class="breadcrumb"><a href="/">Home</a><span>›</span>${esc(title)}</div>
<span class="hero-icon">${icon}</span>
<div class="hero-label">${esc(appliance.charAt(0).toUpperCase() + appliance.slice(1))} Repair · Middle TN + LA</div>
<h1>${esc(h1)}<em>Honest, Technician-Led Repair</em></h1>
<p class="hero-sub">${esc(intro)}</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Chat with Ant</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call 615-280-2949</a>
</div>
</div>

<div class="content">

<div class="section">
<div class="section-label">Diagnose Your Problem</div>
<h2>${esc(appliance.charAt(0).toUpperCase() + appliance.slice(1))} Symptoms</h2>
<p class="prose">Pick the symptom that matches what your ${esc(appliance)} is doing. Each page walks through the most common causes, honest pricing, and the 4-option Technician Decision Report.</p>
<div class="related-grid">${symptomLinks}</div>
</div>

<div class="section">
<div class="section-label">By Brand</div>
<h2>${esc(appliance.charAt(0).toUpperCase() + appliance.slice(1))}s We Repair</h2>
<p class="prose">We work on every major brand. Brand-specific pages cover the common failure patterns and parts availability for each platform.</p>
<div class="brand-grid">${brandLinks}</div>
</div>

<div class="section">
<div class="section-label">How the TDR Works</div>
<h2>The 4-Option Decision Report</h2>
<p class="prose">Every ${esc(appliance)} repair starts with a real technician reviewing your model and symptoms. You get a Technician Decision Report with four options and real pricing — pick what works for you.</p>
${renderTDRGrid()}
</div>

<div class="section">
<div class="section-label">Pricing</div>
<h2>Real Numbers, No Mystery</h2>
${renderPricingBlock()}
</div>

<div class="section">
<div class="section-label">Is It Worth Fixing?</div>
<h2>Our Philosophy on Repair vs. Replace</h2>
<p class="prose">Age is not the deciding factor. Parts availability and labor complexity are. A well-built ten-year-old ${esc(appliance)} with available parts is almost always worth fixing. A newer unit with a discontinued board is the harder call. The <a href="/should-i-repair-or-replace">replacement calculator</a> gives you a quick framing, and our technicians give you the real numbers on your specific machine — every situation is different.</p>
</div>

<div class="section">
<div class="section-label">FAQ</div>
<h2>People Also Ask</h2>
<div class="faq">${faqHtml}</div>
</div>

<div class="section">
<div class="section-label">Where We Service</div>
<h2>Middle TN + Louisiana</h2>
<div class="cities-tag">${renderCityTags()}</div>
</div>

<div class="cta-section">
<div class="section-label">Get Started</div>
<h2>Chat with Ant — Get a Real Answer Today</h2>
<p>${esc(ANT_CTA_TEXT)}</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Start the Quick Check — $50</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call Instead</a>
</div>
</div>

</div>
${buildFooter()}
</div>
</body>
</html>`;

  return head + body;
}

// ===== How It Works page =====
function buildHowItWorks() {
  const slug = "how-it-works";
  const metaTitle = "How TN Appliance Exchange Works — From Broken to Fixed | TN Appliance Exchange";
  const metaDesc = "Step-by-step: chat with Ant, share a video and model number, get a Technician Decision Report with 4 options and real pricing. Diagnostic fee credited to repair.";
  const keywords = "how appliance repair works, appliance diagnostic process, technician decision report, TDR, appliance repair Nashville";

  const faqs = [
    { q: "How does the appliance diagnosis actually work?", a: "Chat with Ant on our site. Share your appliance, symptoms, model number photo, and a short video. A real technician reviews it — usually within hours — and builds a Technician Decision Report with four options and real pricing." },
    { q: "What's a Technician Decision Report?", a: "A short, clear write-up from your assigned technician that explains exactly what's wrong, what the repair options are, and what each one costs. Four options total: OEM part only, equivalent part only, OEM part + labor, equivalent part + labor. You pick which one works for you." },
    { q: "How much is the diagnostic fee?", a: "$50 for a Quick Check (chat-based diagnosis from a technician reviewing your photos, video, and model). $100 for an in-home diagnostic visit. Both apply directly to repair labor if you proceed." },
    { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee becomes credit toward your repair labor. Pay $50 for the Quick Check, get $50 off your repair labor. Pay $100 in-home, get $100 off. You only pay once." },
    { q: "Can I do the repair myself?", a: "Yes — that's what Option 1 and Option 2 of the TDR are for. We source the right part and ship directly to you; you install. Important caveat: if you start the repair yourself and then ask us to take over, the technician may charge additional labor or decline the job. Choose your option before anyone touches the appliance." },
    { q: "Why don't you share part numbers?", a: "Two reasons. First, the wrong part causes return shipping, re-diagnosis, and frustration — we source the correct part the first time so it just shows up at your door. Second, our parts pricing includes the support and warranty we stand behind. You get the right part, shipped directly, with our backing." }
  ];

  const crumbs = [
    { name: "Home", url: `${SITE}/` },
    { name: "How It Works", url: `${SITE}/how-it-works` }
  ];

  const schemas = [schemaLocalBusiness(), schemaService("Appliance Repair"), schemaFAQ(faqs), schemaBreadcrumbs(crumbs)];

  const head = buildHead({ slug, title: "How It Works", metaTitle, metaDesc, keywords, schemas });

  const faqHtml = faqs.map(f => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join("");

  const body = `<body>
<div class="bg"><div class="bg-orb orb1"></div><div class="bg-orb orb2"></div></div>
<div class="shell">
${buildNav()}
<div class="hero">
<div class="breadcrumb"><a href="/">Home</a><span>›</span>How It Works</div>
<div class="hero-label">The Process</div>
<h1>How It Works<em>From Broken to Fixed</em></h1>
<p class="hero-sub">No hold music. No truck-roll surprises. No mystery parts. Just an honest diagnosis from a real technician, four clear options, and real pricing — before anyone touches your appliance.</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Start with Ant</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call 615-280-2949</a>
</div>
</div>

<div class="content">

<div class="section">
<div class="section-label">The 4 Steps</div>
<h2>Broken to Fixed in Four Steps</h2>
<div class="process-steps">

<div class="process-step">
<span class="process-num">1</span>
<div class="process-content">
<h3>Chat with Appliance Ant — Tell Us Your Machine</h3>
<p>Open the chat on our homepage. Tell Ant which appliance is acting up and what it's doing wrong. No forms, no hold music, no scripted call center. Ant is online 24/7 and trained to ask the right questions.</p>
</div>
</div>

<div class="process-step">
<span class="process-num">2</span>
<div class="process-content">
<h3>Send a Video and Your Model Number</h3>
<p>Take a quick video of the appliance doing whatever it's doing (or not doing). Snap a photo of the model number plate — usually inside the door, behind a kick panel, or on the back. Ant guides you to the right spot. That's it for the customer side.</p>
</div>
</div>

<div class="process-step">
<span class="process-num">3</span>
<div class="process-content">
<h3>A Real Technician Builds Your TDR</h3>
<p>One of our six technicians reviews your video, the model number, and your symptoms. They identify exactly what's wrong — or what the diagnostic visit needs to confirm — and build a Technician Decision Report (TDR). Usually within hours, not days.</p>
</div>
</div>

<div class="process-step">
<span class="process-num">4</span>
<div class="process-content">
<h3>You Pick One of Four Options — Real Pricing</h3>
<p>The TDR shows you four ways to solve the problem with real prices. OEM part only, equivalent part only, OEM part + labor, equivalent part + labor. You pick the option that works for your situation. No surprises, no hidden costs, no commitment until you choose.</p>
</div>
</div>

</div>
</div>

<div class="section">
<div class="section-label">The 4 Options Explained</div>
<h2>What Each Option Means</h2>
${renderTDRGrid()}
<p class="prose" style="margin-top:20px"><strong>A note on DIY:</strong> Options 1 and 2 ship parts directly to you with our diagnosis and our backing. You install. We don't publish step-by-step repair instructions for liability reasons — but the part will be correct, and you'll have a verified diagnosis. If you start the repair and then change your mind, get the technician involved before you go further.</p>
</div>

<div class="section">
<div class="section-label">Pricing</div>
<h2>Diagnostic Fee Becomes Repair Credit</h2>
<p class="prose"><strong>Your diagnostic fee is never wasted money.</strong> Every dollar you spend on the Quick Check or in-home diagnostic goes directly toward your repair labor if you proceed. Pay $50 for the Quick Check, get $50 off your repair labor. Pay $100 for the in-home visit, get $100 off your repair labor. You're not paying for a diagnosis AND a repair — you're paying for a diagnosis that becomes a credit toward your repair. No double paying, ever.</p>
${renderPricingBlock()}
</div>

<div class="section">
<div class="section-label">Why We Don't Share Part Numbers</div>
<h2>We Source and Ship Directly</h2>
<p class="prose">Most appliance repair companies expect you to find your own part. We don't — and we don't share part numbers either. Here's why: the wrong part causes return shipping, re-diagnosis, and frustration. We source the correct part the first time and ship it directly to your door, so you never have to hunt for the right SKU. Our parts come with support and backing. You pay for the right part, shipped correctly, with the diagnostic credit already applied.</p>
</div>

<div class="section">
<div class="section-label">Why a Real Technician, Not a Chatbot</div>
<h2>Honest Answers Require Experience</h2>
<p class="prose">An AI can describe symptoms. An experienced technician knows which symptoms point where on which model — and which ones are worth fixing vs. replacing. Our six technicians have collectively touched thousands of machines across every major brand. When you get a TDR from us, it's a real opinion from a real person who fixes appliances for a living.</p>
</div>

<div class="section">
<div class="section-label">FAQ</div>
<h2>Common Questions</h2>
<div class="faq">${faqHtml}</div>
</div>

<div class="section">
<div class="section-label">Where We Service</div>
<h2>Middle TN + Louisiana</h2>
<p class="prose">Six technicians serving Middle Tennessee and Louisiana. Whether you're in Nashville, Murfreesboro, Antioch, Clarksville, New Orleans, Baton Rouge, or Hammond, the process is the same.</p>
<div class="cities-tag">${renderCityTags()}</div>
</div>

<div class="cta-section">
<div class="section-label">Ready?</div>
<h2>Start with Ant — Get a Real Answer Today</h2>
<p>${esc(ANT_CTA_TEXT)}</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Start the Quick Check — $50</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call Instead</a>
</div>
</div>

</div>
${buildFooter()}
</div>
</body>
</html>`;

  return head + body;
}

// ===== Appliance Ant brand page =====
function buildAntPage() {
  const slug = "appliance-ant";
  const metaTitle = "Appliance Ant — The AI Appliance Repair Assistant That Connects You to Real Technicians";
  const metaDesc = "Appliance Ant is the AI appliance-repair assistant that connects you to a real human technician. Chat 24/7. Get a Technician Decision Report with 4 options and real pricing.";
  const keywords = "Appliance Ant, AI appliance repair, appliance chatbot, instant appliance diagnosis, AI appliance assistant, virtual appliance technician, appliance repair AI";

  const faqs = [
    { q: "What is Appliance Ant?", a: "Appliance Ant is the front-door AI assistant for TN Appliance Exchange — a family-owned appliance repair business. Ant gathers your symptoms, model number, and a quick video, then hands the case to a real technician who builds a Technician Decision Report with four options and real pricing." },
    { q: "Is Appliance Ant just a chatbot?", a: "Ant is the intake assistant — but the diagnosis comes from a real human technician, not an AI. The model number, video, and symptoms you share with Ant get reviewed by one of our six technicians who decides what's actually wrong and what the repair options are. The handoff from AI to human is the whole point." },
    { q: "How fast does Appliance Ant respond?", a: "Ant is online 24/7. The technician handoff usually happens within hours — sometimes minutes for straightforward cases. No call center, no hold music, no waiting until business hours." },
    { q: "Who built Appliance Ant?", a: "Appliance Ant is built by TN Appliance Exchange — Teddy and Alyse Pivacek, a family-owned business in Tennessee. Six technicians across Middle Tennessee and Louisiana use Ant to triage customer requests and deliver Technician Decision Reports." },
    { q: "Is Appliance Ant available everywhere?", a: "Right now Appliance Ant powers TN Appliance Exchange's service area: Middle Tennessee and Louisiana. The technology is licensable to other appliance repair operators who want the same triage-to-TDR workflow." },
    { q: "How much does it cost to use Appliance Ant?", a: "Starting the chat is free. The $50 Quick Check fee gets you a real technician's diagnosis and your Technician Decision Report. That fee applies directly to your repair labor if you proceed — so it's not money out the door, it's a credit toward your fix." }
  ];

  const crumbs = [
    { name: "Home", url: `${SITE}/` },
    { name: "Appliance Ant", url: `${SITE}/appliance-ant` }
  ];

  const schemas = [
    schemaLocalBusiness(),
    schemaService("Appliance Repair"),
    schemaFAQ(faqs),
    schemaBreadcrumbs(crumbs),
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Appliance Ant",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: "AI appliance repair assistant that connects customers to real technicians for honest, multi-option repair diagnoses.",
      offers: { "@type": "Offer", price: "50", priceCurrency: "USD" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6", reviewCount: "323" }
    }
  ];

  const head = buildHead({ slug, title: "Appliance Ant", metaTitle, metaDesc, keywords, schemas });

  const faqHtml = faqs.map(f => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join("");

  const body = `<body>
<div class="bg"><div class="bg-orb orb1"></div><div class="bg-orb orb2"></div></div>
<div class="shell">
${buildNav()}
<div class="hero">
<div class="breadcrumb"><a href="/">Home</a><span>›</span>Appliance Ant</div>
<span class="hero-icon">🐜</span>
<div class="hero-label">The AI Appliance Assistant</div>
<h1>Appliance Ant<em>The Bridge Between AI and a Real Technician</em></h1>
<p class="hero-sub">Most appliance-repair calls start the same way: hold music, a half-trained dispatcher, a guess at the truck-roll cost. <strong>Ant is different.</strong> Tell him what's wrong. Share a quick video and a model number photo. A real technician — not an AI — builds your Technician Decision Report and gives you four honest options with real pricing.</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Chat with Ant Now</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call 615-280-2949</a>
</div>
<div class="quick-answer"><p>Appliance Ant is the front door to TN Appliance Exchange, a family-owned appliance repair business serving Middle Tennessee and Louisiana. Ant gathers your symptoms; a real human technician makes the diagnosis. The result: honest answers, real pricing, no truck-roll surprises.</p></div>
</div>

<div class="content">

<div class="section">
<div class="section-label">The Story</div>
<h2>Why Ant Exists</h2>
<p class="prose">Appliance repair has a trust problem. The standard model — call a number, wait on hold, schedule a visit, pay $100 to a tech who shrugs and says "you need a new one" — is broken. Customers get sold replacements they don't need. Repairs that should cost $200 end up costing $500 because nobody explained the options up front. Or the appliance gets replaced entirely, and the family that owns it pays $1,200 for a machine that should have been fixed for $250.</p>
<p class="prose"><strong>Teddy and Alyse Pivacek built Appliance Ant to fix that.</strong> Teddy is the lead technician — fifteen years of appliance work in Tennessee, every brand, every failure mode. Alyse runs operations. Together they realized the bottleneck wasn't fixing appliances. It was the friction between a customer with a broken machine and a technician who could honestly tell them what to do about it.</p>
<p class="prose">Ant removes that friction. Ant is online 24/7 — when the dryer stops heating at 10 PM and you're staring at a hamper of wet clothes, Ant is there. Ant collects the model number, a video of the symptom, and the customer's situation. Then a real human technician — Teddy, or one of our five other techs — reviews it and builds the Technician Decision Report. Real opinion. Real pricing. Real options.</p>
</div>

<div class="section">
<div class="section-label">The 4-Option TDR</div>
<h2>What Makes the TDR Different</h2>
<p class="prose">Every Ant-led job ends in a Technician Decision Report. The TDR is what makes this different from every other appliance repair business — and it's what makes the customer in control instead of the technician.</p>
${renderTDRGrid()}
<p class="prose" style="margin-top:18px">Every option has a real price before any work starts. The customer picks. No upsell, no scope creep, no "while I'm here let me look at..." The technician's job is to give the customer the four honest options. The customer's job is to pick.</p>
</div>

<div class="section">
<div class="section-label">How Ant Works</div>
<h2>From Broken to Fixed</h2>
<div class="process-steps">
<div class="process-step"><span class="process-num">1</span><div class="process-content"><h3>Chat opens at any time, on any device</h3><p>The Ant widget is on tnapplianceexchange.net. Phone, laptop, tablet — anywhere. Tell Ant which appliance is broken.</p></div></div>
<div class="process-step"><span class="process-num">2</span><div class="process-content"><h3>Share video and model number</h3><p>Ant walks the customer through capturing what the appliance is doing (or not doing) and where to find the model number plate. Most appliances: under a minute.</p></div></div>
<div class="process-step"><span class="process-num">3</span><div class="process-content"><h3>Technician builds the TDR</h3><p>A real technician reviews the case and writes up four options with real pricing. Usually within hours.</p></div></div>
<div class="process-step"><span class="process-num">4</span><div class="process-content"><h3>Customer picks an option</h3><p>One option. One price. No surprises. We ship the part directly or schedule the in-home repair.</p></div></div>
</div>
</div>

<div class="section">
<div class="section-label">The Family Behind It</div>
<h2>TN Appliance Exchange — Family-Owned, Technician-Led</h2>
<p class="prose">Teddy Pivacek runs the technical side. Six technicians on the team across Middle Tennessee and Louisiana. Alyse Pivacek runs operations and customer relationships. The business is family-owned — no investor pressure, no corporate franchise model. The decisions made about how repairs work, what gets quoted, how customers get treated — they're made by the people who'll pick up the next call themselves.</p>
<p class="prose">That's the difference. The technician building your TDR is the same person who'll show up to your house if you pick the in-home option. The owner who decided to source parts directly instead of making customers hunt for SKUs is the same person who'll personally handle a complaint if something goes wrong. <strong>This is a small business with small-business accountability — at the speed of an AI assistant.</strong></p>
</div>

<div class="section">
<div class="section-label">For Partners and Press</div>
<h2>Licensing &amp; Partnership</h2>
<p class="prose">Appliance Ant is built on a workflow that any appliance repair operator can use — the 4-option Technician Decision Report, the AI triage, the credited diagnostic fee. We're actively talking with appliance repair operators in other markets about licensing the model. For press, partnership, or licensing inquiries: <a href="mailto:tnappliancerepair@gmail.com">tnappliancerepair@gmail.com</a>.</p>
</div>

<div class="section">
<div class="section-label">FAQ</div>
<h2>Common Questions About Ant</h2>
<div class="faq">${faqHtml}</div>
</div>

<div class="cta-section">
<div class="section-label">Try Ant</div>
<h2>Got a Broken Appliance? Start the Chat.</h2>
<p>${esc(ANT_CTA_TEXT)}</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Chat with Ant Now</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call Instead</a>
</div>
</div>

</div>
${buildFooter()}
</div>
</body>
</html>`;

  return head + body;
}

// ===== Replacement Calculator page =====
function buildCalculator() {
  const slug = "should-i-repair-or-replace";
  const metaTitle = "Should I Repair or Replace My Appliance? Honest Calculator | TN Appliance Exchange";
  const metaDesc = "Use the honest appliance repair-vs-replace calculator. Considers parts availability, labor complexity, and prior repairs — not just age. Then chat with Ant for a real opinion.";
  const keywords = "should I repair or replace appliance, appliance repair calculator, is my appliance worth fixing, repair or replace washer, repair or replace refrigerator, repair or replace dryer";

  const faqs = [
    { q: "When is an appliance not worth repairing?", a: "When parts are discontinued or backordered indefinitely, when the cost of the repair exceeds 50–60% of a comparable new unit, OR when multiple major systems are failing simultaneously. Age alone is not a deciding factor — well-built older machines are often very much worth fixing." },
    { q: "Is age the most important factor?", a: "No — parts availability and labor complexity matter more. A 15-year-old Whirlpool with an available motor coupler is absolutely worth $250 to fix. A 5-year-old Samsung with a failed sealed-system compressor is often the call where replacement makes more sense." },
    { q: "How accurate is this calculator?", a: "It gives you a framing — a rough recommendation based on age, repair cost, prior repair history, and parts availability. The honest answer requires a real technician looking at your specific machine. Use this as a starting point; chat with Ant for the real opinion." },
    { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 Quick Check or $100 in-home diagnostic applies directly to repair labor if you proceed. You only pay once." }
  ];

  const crumbs = [
    { name: "Home", url: `${SITE}/` },
    { name: "Repair or Replace?", url: `${SITE}/should-i-repair-or-replace` }
  ];

  const schemas = [schemaLocalBusiness(), schemaService("Appliance Repair Consulting"), schemaFAQ(faqs), schemaBreadcrumbs(crumbs)];

  const head = buildHead({ slug, title: "Repair or Replace?", metaTitle, metaDesc, keywords, schemas });

  const faqHtml = faqs.map(f => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join("");

  // Calculator-specific CSS appended inline.
  const calcCSS = `
.calc-card{background:var(--surface);border:1px solid var(--bord2);border-radius:14px;padding:30px 28px;margin-top:24px}
.calc-q{font-family:var(--block);font-size:18px;color:var(--white);letter-spacing:.03em;margin-bottom:14px}
.calc-row{margin-bottom:24px}
.calc-options{display:flex;flex-wrap:wrap;gap:8px}
.calc-options button{background:transparent;color:var(--white);border:1px solid var(--bord2);border-radius:10px;padding:12px 18px;font-family:var(--mono);font-size:12px;letter-spacing:.04em;cursor:pointer;transition:all .2s}
.calc-options button:hover{border-color:var(--orange);color:var(--orange)}
.calc-options button.sel{background:var(--orange);color:#000;border-color:var(--orange);font-weight:600}
.calc-input{width:100%;background:#050505;color:var(--white);border:1px solid var(--bord2);border-radius:10px;padding:14px 16px;font-family:var(--mono);font-size:14px;letter-spacing:.02em}
.calc-input:focus{outline:none;border-color:var(--orange)}
#calc-result{margin-top:24px;display:none}
#calc-result.show{display:block;animation:hero-in .4s ease forwards}
.verdict-card{padding:28px;border-radius:14px;border:1px solid rgba(255,98,0,.3);background:linear-gradient(135deg,rgba(255,98,0,.08),rgba(255,98,0,.02))}
.verdict-label{font-family:var(--block);font-size:12px;letter-spacing:.16em;color:var(--orange);margin-bottom:10px}
.verdict-headline{font-family:var(--block);font-size:28px;color:var(--white);letter-spacing:.03em;margin-bottom:14px;line-height:1.2}
.verdict-body{font-size:13px;color:var(--gray);line-height:1.8;letter-spacing:.01em;margin-bottom:18px}
.verdict-body strong{color:var(--white)}
`.replace(/\s*\n\s*/g, "").replace(/\s{2,}/g, " ");

  // Calculator behavior (vanilla JS).
  const calcJS = `
const state={appliance:null,age:null,cost:null,priorRepair:null,partsAvail:null};
function pick(field,val,btn){state[field]=val;document.querySelectorAll('[data-field="'+field+'"] button').forEach(b=>b.classList.remove('sel'));btn.classList.add('sel');tryRun();}
function setCost(v){state.cost=Number(v)||null;tryRun();}
function tryRun(){
  if(!state.appliance||!state.age||state.cost===null||!state.priorRepair||!state.partsAvail)return;
  const r=evaluate(state);
  const el=document.getElementById('calc-result');
  el.innerHTML='<div class="verdict-card"><div class="verdict-label">'+r.tone+'</div><div class="verdict-headline">'+r.headline+'</div><div class="verdict-body">'+r.body+'</div><a href="/#chat" class="btn-primary">🐜 Get a Real Technician Opinion</a></div>';
  el.classList.add('show');el.scrollIntoView({behavior:'smooth',block:'start'});
}
function evaluate(s){
  const replacementCost={refrigerator:1400,washer:900,dryer:850,dishwasher:700,oven:1300,microwave:300,'gas range':1400,disposal:300}[s.appliance]||1000;
  const ratio=s.cost/replacementCost;
  const partsFlag=s.partsAvail==='no';
  const partsUnsure=s.partsAvail==='not sure';
  const recentRepair=s.priorRepair==='yes';
  // Strong replace signals: parts unavailable, OR repair >60% of new, OR (>10 years AND multiple priors AND repair >40%).
  if(partsFlag){return{tone:'Replacement Likely',headline:'Parts Availability Is The Blocker',body:'When parts are discontinued, the repair conversation gets very different. Sometimes aftermarket equivalents exist; sometimes a creative tech can substitute parts from another model. <strong>Don\\'t make the replace call yet — chat with Ant.</strong> Our techs check parts availability through channels the public can\\'t reach, and we\\'ve sourced "discontinued" parts more than once.'}}
  if(ratio>0.6){return{tone:'Lean Toward Replace',headline:'The Repair Is More Than 60% Of A New One',body:'At more than 60% of replacement cost, the math starts to favor a new appliance — <em>especially</em> if you can get a better warranty and improved efficiency. <strong>But this isn\\'t automatic.</strong> If you\\'re repairing a premium machine (built-in fridge, dual-fuel range, high-end Bosch dishwasher), the math shifts back toward repair because replacement at the same quality tier is much higher than the $'+replacementCost+' typical. Chat with Ant for the real call on your specific machine.'}}
  if(ratio>0.4&&recentRepair&&s.age==='15+'){return{tone:'Honest Conversation Needed',headline:'Multiple Repairs On An Older Machine',body:'When an older appliance has already been repaired recently and is now needing more work, it usually means systems are failing in sequence. <strong>The next repair is rarely the last.</strong> Chat with Ant — our techs will tell you honestly if this is the point where replacement makes more financial sense, or if your specific machine still has plenty of life left.'}}
  if(partsUnsure){return{tone:'Diagnostic First',headline:'Don\\'t Decide Until You Know What\\'s Broken',body:'The "is it worth fixing" question can\\'t be answered honestly without knowing exactly what\\'s broken. A $200 thermal fuse fix is different from an $800 sealed-system repair, even on the same age machine. <strong>Get the $50 Quick Check.</strong> The diagnostic fee credits toward your repair if you proceed, so you\\'re not paying for the diagnosis separately.'}}
  return{tone:'Repair Likely Wins',headline:'This Machine Is Probably Worth Fixing',body:'Based on what you\\'ve told us, repair likely makes more sense than replacement. The repair cost is a fraction of a new unit, parts are available, and the machine doesn\\'t show signs of cascading failure. <strong>But every situation is different.</strong> Chat with Ant — a real technician will confirm exactly what\\'s wrong and give you four real options with real pricing on the Technician Decision Report.'}
}
`.replace(/\n/g, "");

  const body = `<body>
<div class="bg"><div class="bg-orb orb1"></div><div class="bg-orb orb2"></div></div>
<div class="shell">
${buildNav()}
<div class="hero">
<div class="breadcrumb"><a href="/">Home</a><span>›</span>Repair or Replace?</div>
<div class="hero-label">Honest Calculator · Not An Age Formula</div>
<h1>Should I Repair<em>Or Replace?</em></h1>
<p class="hero-sub">Most repair-or-replace calculators are just age formulas. Ours isn't. <strong>Parts availability and labor complexity matter more than age</strong> — and well-built older machines are often absolutely worth fixing. Answer five questions to get an honest framing. Then chat with Ant for a real technician's opinion on your specific machine.</p>
</div>

<div class="content">

<div class="section">
<style>${calcCSS}</style>
<div class="calc-card">

<div class="calc-row" data-field="appliance">
<div class="calc-q">1 · What appliance?</div>
<div class="calc-options">
<button onclick="pick('appliance','refrigerator',this)">Refrigerator</button>
<button onclick="pick('appliance','washer',this)">Washer</button>
<button onclick="pick('appliance','dryer',this)">Dryer</button>
<button onclick="pick('appliance','dishwasher',this)">Dishwasher</button>
<button onclick="pick('appliance','oven',this)">Oven / Range</button>
<button onclick="pick('appliance','gas range',this)">Gas Range</button>
<button onclick="pick('appliance','microwave',this)">Microwave</button>
<button onclick="pick('appliance','disposal',this)">Garbage Disposal</button>
</div>
</div>

<div class="calc-row" data-field="age">
<div class="calc-q">2 · How old is it?</div>
<div class="calc-options">
<button onclick="pick('age','0-5',this)">0–5 years</button>
<button onclick="pick('age','5-10',this)">5–10 years</button>
<button onclick="pick('age','10-15',this)">10–15 years</button>
<button onclick="pick('age','15+',this)">15+ years</button>
</div>
</div>

<div class="calc-row">
<div class="calc-q">3 · Estimated repair cost (your best guess — Ant will give the real number)</div>
<input type="number" class="calc-input" placeholder="$" oninput="setCost(this.value)">
</div>

<div class="calc-row" data-field="priorRepair">
<div class="calc-q">4 · Has it been repaired before in the last 2 years?</div>
<div class="calc-options">
<button onclick="pick('priorRepair','no',this)">No</button>
<button onclick="pick('priorRepair','yes',this)">Yes — once or twice</button>
<button onclick="pick('priorRepair','many',this)">Yes — multiple times</button>
</div>
</div>

<div class="calc-row" data-field="partsAvail">
<div class="calc-q">5 · Are parts still available?</div>
<div class="calc-options">
<button onclick="pick('partsAvail','yes',this)">Yes</button>
<button onclick="pick('partsAvail','no',this)">No / Discontinued</button>
<button onclick="pick('partsAvail','not sure',this)">Not sure</button>
</div>
</div>

</div>
<div id="calc-result"></div>
<script>${calcJS}</script>
</div>

<div class="section">
<div class="section-label">Our Philosophy</div>
<h2>Why Age Isn't The Right Question</h2>
<p class="prose">The standard appliance-industry "rule" — replace anything over 50% of its lifespan — is wrong. It treats every machine the same, ignores parts availability, ignores build quality, and pushes customers toward replacement decisions that don't make financial sense.</p>
<p class="prose"><strong>Older machines are often worth fixing.</strong> A 15-year-old Whirlpool top-load washer was built with metal parts and a serviceable transmission. A motor coupler repair gives it another decade. By contrast, some 5-year-old high-end front-loaders with failed spider arms are genuinely tough calls — the parts cost is high, the labor is significant, and replacement at the same quality tier is expensive in a different way.</p>
<p class="prose">Every situation is different. The calculator above gives you a starting framework. The Technician Decision Report gives you the real answer — four options with real pricing, from a real human technician who looked at your specific machine. <a href="/how-it-works">See how the TDR works.</a></p>
</div>

<div class="section">
<div class="section-label">FAQ</div>
<h2>People Also Ask</h2>
<div class="faq">${faqHtml}</div>
</div>

<div class="cta-section">
<div class="section-label">Real Opinion</div>
<h2>Get a Real Technician's Take</h2>
<p>${esc(ANT_CTA_TEXT)}</p>
<div class="cta-row">
<a href="/#chat" class="btn-primary">🐜 Chat with Ant — $50</a>
<a href="tel:6152802949" class="btn-secondary">📞 Call Instead</a>
</div>
</div>

</div>
${buildFooter()}
</div>
</body>
</html>`;

  return head + body;
}

// ===== MAIN =====
function run() {
  const written = [];

  // Symptom pages.
  for (const s of symptoms) {
    const html = buildSymptomPage(s);
    const fp = writeFile(s.slug, html);
    written.push(`SYMPTOM  ${s.slug}.html`);
  }

  // Brand pages.
  for (const b of brands) {
    const html = buildBrandPage(b);
    const fp = writeFile(b.slug, html);
    written.push(`BRAND    ${b.slug}.html`);
  }

  // Hub pages.
  const hubs = [
    { slug: "dryer-repair", appliance: "dryer", title: "Dryer Repair", h1: "Dryer Repair",
      metaTitle: "Dryer Repair Nashville, Murfreesboro, Antioch + LA | TN Appliance Exchange",
      metaDesc: "Dryer not heating, spinning, or running? Honest 4-option Technician Decision Report from a real tech. $50 Quick Check credited to repair. Middle TN + Louisiana.",
      keywords: "dryer repair, dryer repair Nashville, dryer repair Tennessee, dryer not heating, dryer making noise, gas dryer repair, electric dryer repair",
      intro: "Dryers are some of the most repairable appliances in your home. Most failures — thermal fuse, heating element, belt, idler, roller — are inexpensive parts and well-documented repairs. We don't replace dryers that are worth fixing.",
      icon: "🌀" },
    { slug: "washer-repair", appliance: "washer", title: "Washer Repair", h1: "Washer Repair",
      metaTitle: "Washer Repair Nashville, Murfreesboro, Antioch + LA | TN Appliance Exchange",
      metaDesc: "Washer not spinning, draining, or starting? Honest 4-option Technician Decision Report from a real tech. $50 Quick Check credited to repair. Middle TN + Louisiana.",
      keywords: "washer repair, washing machine repair, washer repair Nashville, washer not spinning, washer not draining, front load washer, top load washer",
      intro: "Washers are diagnosable in one visit on most platforms. Whether it's a top-load Whirlpool, a front-load Samsung, or anything in between, our techs know the failure patterns and the cost-effective repairs.",
      icon: "💧" },
    { slug: "refrigerator-repair", appliance: "refrigerator", title: "Refrigerator Repair", h1: "Refrigerator Repair",
      metaTitle: "Refrigerator Repair Nashville, Murfreesboro, Antioch + LA | TN Appliance Exchange",
      metaDesc: "Refrigerator not cooling, ice maker problem, or making noise? Honest 4-option Technician Decision Report from a real tech. $50 Quick Check credited.",
      keywords: "refrigerator repair, fridge repair, refrigerator repair Nashville, refrigerator not cooling, ice maker repair, French door refrigerator",
      intro: "Refrigerator failures range from $200 fixes (defrost, fan, ice maker) to $1,500+ sealed-system jobs. Knowing which category your machine falls into is the whole point of the diagnostic — and it's where honest opinion matters most.",
      icon: "🧊" }
  ];
  for (const h of hubs) {
    const html = buildHubPage(h);
    writeFile(h.slug, html);
    written.push(`HUB      ${h.slug}.html`);
  }

  // How it works.
  writeFile("how-it-works", buildHowItWorks());
  written.push("MISC     how-it-works.html");

  // Appliance Ant.
  writeFile("appliance-ant", buildAntPage());
  written.push("MISC     appliance-ant.html");

  // Calculator.
  writeFile("should-i-repair-or-replace", buildCalculator());
  written.push("MISC     should-i-repair-or-replace.html");

  console.log(written.join("\n"));
  console.log(`\nTotal pages written: ${written.length}`);
}

run();
