#!/usr/bin/env node
// Deepen existing city pages WITHOUT replacing tech assignments or phone numbers.
// Inject new sections (worth-fixing philosophy, 4-option TDR, calculator link,
// symptom + brand internal links, dual-fee credit note) BEFORE the existing
// CTA section. Idempotent — uses a sentinel comment to skip pages already
// processed.

const fs = require("fs");
const path = require("path");

const SENTINEL_OPEN = "<!-- DEEPEN-START 2026-05-14 -->";
const SENTINEL_CLOSE = "<!-- DEEPEN-END -->";

const REPO = path.resolve(__dirname, "../..");

const CITIES = [
  { slug: "nashville", name: "Nashville", state: "TN", region: "Middle Tennessee",
    nearby: "Antioch, Brentwood, Hermitage, Madison, and Franklin",
    localContext: "Music City covers everything from East Nashville bungalows to the Belle Meade estates and the Sylvan Park family neighborhoods. Most homes here have appliance loads built for families, and our techs see the full range — from twenty-year-old GE side-by-sides in older homes to brand-new LG ThinQ kitchens in new construction." },
  { slug: "murfreesboro", name: "Murfreesboro", state: "TN", region: "Middle Tennessee",
    nearby: "Smyrna, La Vergne, Eagleville, and Christiana",
    localContext: "Rutherford County is one of the fastest-growing markets in the Southeast. We see a lot of newer construction with bundled GE and Whirlpool packages, plus older Murfreesboro and Smyrna homes with the more durable platforms that age very well." },
  { slug: "antioch", name: "Antioch", state: "TN", region: "Middle Tennessee",
    nearby: "Cane Ridge, Priest Lake, and southeast Nashville",
    localContext: "Antioch is a busy mix of established neighborhoods and newer family construction. Our techs cover from Bell Road south through Cane Ridge, and we see all major brands in the area." },
  { slug: "clarksville", name: "Clarksville", state: "TN", region: "Montgomery County, Tennessee",
    nearby: "Sango, Cumberland Heights, Woodlawn, and Oak Grove",
    localContext: "Clarksville is one of our most active markets — military families on rotation through Fort Campbell, a strong base of long-time residents, and a steady appetite for honest repair that doesn't pressure replacement on every visit." },
  { slug: "brentwood", name: "Brentwood", state: "TN", region: "Middle Tennessee",
    nearby: "Franklin, Cool Springs, Forest Hills, and Oak Hill",
    localContext: "Brentwood homes lean toward premium appliances — Sub-Zero refrigerators, Wolf ranges, KitchenAid built-ins, and high-end LG and Samsung packages. Our techs are comfortable across this range, and we always quote both repair and replacement honestly given how expensive built-in replacement can be." },
  { slug: "franklin", name: "Franklin", state: "TN", region: "Williamson County, Tennessee",
    nearby: "Cool Springs, Spring Hill, Thompson's Station, and Leiper's Fork",
    localContext: "Franklin's mix of historic downtown homes and Cool Springs new construction means we see both older serviceable platforms (which are very much worth fixing) and newer premium installations. The repair-vs-replace conversation matters more here because the replacement quality tier is high." },
  { slug: "hermitage", name: "Hermitage", state: "TN", region: "East Nashville suburbs",
    nearby: "Old Hickory, Mt. Juliet, and Donelson",
    localContext: "Hermitage covers a wide swath of east Davidson County — established neighborhoods around Old Hickory Lake and newer construction toward Mt. Juliet. Most of our Hermitage jobs are mid-tier appliances that respond well to standard repairs." },
  { slug: "hendersonville", name: "Hendersonville", state: "TN", region: "Sumner County, Tennessee",
    nearby: "Gallatin, Goodlettsville, and Old Hickory",
    localContext: "Hendersonville is family-oriented and the appliance mix reflects it — heavy use, multi-load laundry, big refrigerators. The machines work hard up here and most failures are wear-related, not design defects." },
  { slug: "gallatin", name: "Gallatin", state: "TN", region: "Sumner County, Tennessee",
    nearby: "Hendersonville, Castalian Springs, and Bethpage",
    localContext: "Gallatin spans newer Volunteer State Community College area construction to older established homes along Highway 109. Both ends respond well to honest diagnostic and the right repair the first time." },
  { slug: "smyrna", name: "Smyrna", state: "TN", region: "Rutherford County, Tennessee",
    nearby: "La Vergne, Murfreesboro, and Almaville",
    localContext: "Smyrna is a busy commuter market with a growing mix of new construction and established neighborhoods. The Nissan plant area sees a lot of family appliances getting hard daily use." },
  { slug: "la-vergne", name: "La Vergne", state: "TN", region: "Rutherford County, Tennessee",
    nearby: "Smyrna, Antioch, and Murfreesboro",
    localContext: "La Vergne is one of the steadier markets between Nashville and Murfreesboro. We see a heavy mix of Whirlpool and Frigidaire here — both very repairable platforms." },
  { slug: "lebanon", name: "Lebanon", state: "TN", region: "Wilson County, Tennessee",
    nearby: "Mt. Juliet, Watertown, and Carthage",
    localContext: "Lebanon ranges from historic downtown to newer construction around Providence and toward Mt. Juliet. Cumberland University and the surrounding area give us a steady mix of residential appliance work." },
  { slug: "mt-juliet", name: "Mt. Juliet", state: "TN", region: "Wilson County, Tennessee",
    nearby: "Hermitage, Lebanon, and Old Hickory",
    localContext: "Mt. Juliet has grown fast. Lots of newer construction with bundled packages — GE Profile, Whirlpool, Samsung — and the appliances are now hitting the 5–10 year mark where common repairs become routine." },
  { slug: "nolensville", name: "Nolensville", state: "TN", region: "Williamson County, Tennessee",
    nearby: "Brentwood, Franklin, and Triune",
    localContext: "Nolensville covers a wide range from established farms to brand-new family construction. The Cane Ridge corridor down to historic Nolensville sees a steady stream of mid-to-premium appliance repair." },
  { slug: "spring-hill", name: "Spring Hill", state: "TN", region: "Maury / Williamson County line",
    nearby: "Thompson's Station, Columbia, and Chapel Hill",
    localContext: "Spring Hill is a heavy growth corridor along the Maury and Williamson County line. The GM plant area and Saturn Parkway corridor see a lot of family appliance repair — newer builds with bundled packages aging into their first major service intervals." },
  { slug: "ashland-city", name: "Ashland City", state: "TN", region: "Cheatham County, Tennessee",
    nearby: "Pleasant View, Kingston Springs, and Pegram",
    localContext: "Cheatham County keeps its appliances longer than most markets we serve. Older, well-built machines absolutely worth fixing — and our techs in this area have the experience to know when older parts can still be sourced." },
  { slug: "kingston-springs", name: "Kingston Springs", state: "TN", region: "Cheatham County, Tennessee",
    nearby: "Ashland City, Pegram, and Bellevue",
    localContext: "Kingston Springs sits along the Harpeth River corridor between Nashville and the Cumberland River. Rural-suburban mix; appliances tend to be older but very serviceable platforms." },
  { slug: "pleasant-view", name: "Pleasant View", state: "TN", region: "Cheatham County, Tennessee",
    nearby: "Ashland City, Joelton, and Greenbrier",
    localContext: "Pleasant View covers the northern edge of Cheatham County. Newer subdivisions and established farms; both ends of the market see steady appliance repair demand." },
  // Louisiana
  { slug: "baton-rouge", name: "Baton Rouge", state: "LA", region: "East Baton Rouge Parish",
    nearby: "Prairieville, Gonzales, Walker, Baker, Central, Zachary, and Denham Springs",
    localContext: "Baton Rouge runs from historic Garden District homes to LSU rentals to Highland Road estates to newer family construction in the Mall of Louisiana corridor. The humidity here is hard on appliances — gaskets, defrost systems, and ice makers fail more frequently than in drier climates, and we've calibrated our diagnostic process accordingly." },
  { slug: "new-orleans", name: "New Orleans", state: "LA", region: "Orleans Parish",
    nearby: "Metairie, Kenner, Chalmette, Algiers, and Gentilly",
    localContext: "New Orleans homes are some of the most distinctive in the country — and the heat and humidity put appliances through real stress. We see a lot of older Uptown homes with well-built mid-century kitchens still serviceable, plus the newer build-outs through Bywater and Lakeview where modern appliance packages now need their first major repairs." },
  { slug: "hammond", name: "Hammond", state: "LA", region: "Tangipahoa Parish",
    nearby: "Ponchatoula, Independence, Albany, Walker, and Robert",
    localContext: "Hammond is a hub for Tangipahoa Parish and we cover a lot of ground from here — Southeastern Louisiana University area, the established North Oak Street neighborhoods, and the newer construction toward I-12. Humidity makes refrigerator defrost and washer gasket repairs more frequent than the national average." },
  { slug: "metairie", name: "Metairie", state: "LA", region: "Jefferson Parish",
    nearby: "Kenner, Harahan, Old Metairie, and Lakeview",
    localContext: "Metairie covers everything from Lakeview-adjacent established neighborhoods to the Veterans Boulevard commercial corridor to family homes near Lafreniere Park. Most of our work here is mid-tier appliances in their 5–12 year service window — exactly the age where good repairs add years of life." },
  { slug: "kenner", name: "Kenner", state: "LA", region: "Jefferson Parish",
    nearby: "Metairie, Harahan, and the Airport area",
    localContext: "Kenner stretches from the airport corridor through established residential neighborhoods. We see a heavy mix of Whirlpool, GE, and Samsung appliances — and the climate-driven failures (ice maker frost, gasket biofilm) are common." },
  { slug: "chalmette", name: "Chalmette", state: "LA", region: "St. Bernard Parish",
    nearby: "Meraux, Violet, and New Orleans East",
    localContext: "Chalmette and the St. Bernard Parish communities have a strong base of long-term residents. Appliances here tend to get used hard and kept long — which means honest, cost-effective repair is what people actually want, not replacement pressure." },
  { slug: "slidell", name: "Slidell", state: "LA", region: "St. Tammany Parish",
    nearby: "Pearl River, Lacombe, Eden Isles, and Northshore",
    localContext: "Slidell is the gateway to the Northshore and the appliance mix reflects suburban family life — large refrigerators, heavy laundry loads, and ranges that get serious daily use. The lakeside humidity creates the same refrigerator gasket and ice maker issues we see throughout Louisiana." },
  { slug: "mandeville", name: "Mandeville", state: "LA", region: "St. Tammany Parish",
    nearby: "Covington, Madisonville, Abita Springs, and Lewisburg",
    localContext: "Mandeville along the lakefront and through old Mandeville has a steady mix of premium and mid-tier appliances. The Northshore generally trends toward higher-end packages, which makes the repair-vs-replace conversation more nuanced because replacement at the same quality tier is significantly more expensive." },
  { slug: "covington", name: "Covington", state: "LA", region: "St. Tammany Parish",
    nearby: "Mandeville, Abita Springs, Folsom, and Madisonville",
    localContext: "Covington blends historic downtown homes with newer family construction north of I-12. Premium and mid-tier appliances in both segments — and our techs are comfortable across the range." },
  { slug: "walker", name: "Walker", state: "LA", region: "Livingston Parish",
    nearby: "Denham Springs, Watson, and Albany",
    localContext: "Walker is a growing Livingston Parish suburb where most homes have appliances aging into their first major service intervals. Heavy use, hard water in some areas, and humidity all factor into what we see most often." },
  { slug: "denham-springs", name: "Denham Springs", state: "LA", region: "Livingston Parish",
    nearby: "Walker, Watson, Central, and Baton Rouge",
    localContext: "Denham Springs has rebuilt strong since 2016 and we see a lot of post-flood appliance replacements now reaching their first repair cycle. Newer units, well-maintained homes, and a customer base that knows the value of honest service." },
  { slug: "gonzales", name: "Gonzales", state: "LA", region: "Ascension Parish",
    nearby: "Prairieville, Geismar, Sorrento, and Donaldsonville",
    localContext: "Gonzales sits between Baton Rouge and New Orleans on the I-10 corridor. Family-oriented community with steady demand for refrigerator and laundry repair." },
  { slug: "prairieville", name: "Prairieville", state: "LA", region: "Ascension Parish",
    nearby: "Gonzales, Dutchtown, and Baton Rouge",
    localContext: "Prairieville is one of the fastest-growing parts of Ascension Parish. Newer construction with bundled packages now hitting their 5–10 year service window — the sweet spot for cost-effective repairs." },
  { slug: "madisonville", name: "Madisonville", state: "LA", region: "St. Tammany Parish",
    nearby: "Mandeville, Covington, and Goodbee",
    localContext: "Madisonville sits along the Tchefuncte River and covers a mix of historic and newer waterfront properties. Premium appliance packages are common and the repair-vs-replace conversation matters." },
  { slug: "ponchatoula", name: "Ponchatoula", state: "LA", region: "Tangipahoa Parish",
    nearby: "Hammond, Robert, and Manchac",
    localContext: "Ponchatoula's historic downtown and surrounding neighborhoods mix older homes with newer family construction. We service the full range and our techs know which older appliances are worth fixing." },
  { slug: "abita-springs", name: "Abita Springs", state: "LA", region: "St. Tammany Parish",
    nearby: "Mandeville, Covington, and Talisheek",
    localContext: "Abita Springs is one of the quieter Northshore towns and the appliances reflect a community that keeps things well-maintained. Older platforms in good condition — exactly what repairs were designed for." },
  { slug: "pearl-river", name: "Pearl River", state: "LA", region: "St. Tammany Parish",
    nearby: "Slidell, Lacombe, and the Mississippi border",
    localContext: "Pearl River is east of Slidell along the Mississippi state line. Mix of established homes and newer family construction. Standard mid-tier appliance load." },
  { slug: "laplace", name: "Laplace", state: "LA", region: "St. John the Baptist Parish",
    nearby: "Reserve, Garyville, and Edgard",
    localContext: "Laplace is an industrial-corridor community with a mix of older established homes and newer construction. Standard major-brand appliance mix and steady demand for honest service." },
  { slug: "pumpkin-center", name: "Pumpkin Center", state: "LA", region: "Tangipahoa Parish",
    nearby: "Hammond, Robert, and Albany",
    localContext: "Pumpkin Center is a small community in Tangipahoa Parish where older, well-built appliances are kept in service longer than the national average. Honest repair is the model that fits here." }
];

// Common symptom links — appliance-type-balanced.
const TOP_SYMPTOMS = [
  { slug: "dryer-not-heating", label: "Dryer Not Heating" },
  { slug: "dryer-not-spinning", label: "Dryer Not Spinning" },
  { slug: "washer-not-spinning", label: "Washer Not Spinning" },
  { slug: "washer-not-draining", label: "Washer Not Draining" },
  { slug: "refrigerator-not-cooling", label: "Refrigerator Not Cooling" },
  { slug: "refrigerator-not-making-ice", label: "Fridge Ice Maker Broken" },
  { slug: "dishwasher-not-draining", label: "Dishwasher Not Draining" },
  { slug: "oven-not-heating", label: "Oven Not Heating" }
];

const TOP_BRANDS = ["whirlpool","samsung","lg","ge","frigidaire","maytag","bosch","kenmore"];

function buildDeepenBlock(city) {
  const symptomLinks = TOP_SYMPTOMS.map(s =>
    `<a href="/${s.slug}" class="related-link">${s.label}</a>`
  ).join("");

  const brandLinks = TOP_BRANDS.map(b => {
    const label = b === "ge" ? "GE" : b === "lg" ? "LG" : b[0].toUpperCase() + b.slice(1);
    return `<a href="/${b}-appliance-repair" class="brand-link" style="display:inline-block;background:var(--surface);border:1px solid var(--bord2);border-radius:10px;padding:14px 16px;text-decoration:none;color:var(--white);font-size:12px;letter-spacing:.04em;text-align:center;font-family:var(--block);transition:all .2s">${label}</a>`;
  }).join("");

  return `${SENTINEL_OPEN}
<style>
.deep-section{margin-bottom:48px}
.deep-section-label{font-size:10px;color:var(--orange);letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px}
.deep-prose{font-size:14px;color:var(--gray);line-height:1.85;letter-spacing:.01em;margin-bottom:14px}
.deep-prose strong{color:var(--white);font-weight:500}
.deep-prose a{color:var(--orange);text-decoration:none;border-bottom:1px solid rgba(255,98,0,.3)}
.deep-prose a:hover{border-color:var(--orange)}
.deep-quick{background:linear-gradient(135deg,rgba(255,98,0,.07),rgba(255,98,0,.02));border:1px solid rgba(255,98,0,.25);border-radius:14px;padding:24px 28px;margin:24px 0;position:relative}
.deep-quick::before{content:'QUICK ANSWER';position:absolute;top:-9px;left:20px;background:#050505;font-family:var(--block);font-size:11px;letter-spacing:.16em;color:var(--orange);padding:0 8px}
.deep-quick p{font-size:14px;color:var(--white);line-height:1.7;letter-spacing:.01em}
.deep-tdr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}
.deep-tdr-card{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:18px 14px;transition:border-color .2s}
.deep-tdr-card:hover{border-color:rgba(255,98,0,.4)}
.deep-tdr-num{font-family:var(--block);font-size:13px;color:var(--orange);letter-spacing:.08em;margin-bottom:6px}
.deep-tdr-name{font-family:var(--block);font-size:14px;color:var(--white);letter-spacing:.04em;margin-bottom:6px;line-height:1.2}
.deep-tdr-desc{font-size:11px;color:var(--gray);line-height:1.55}
.deep-credit{margin-top:16px;padding:18px 22px;background:rgba(57,255,20,.04);border:1px solid rgba(57,255,20,.15);border-radius:10px;font-size:13px;color:#e8e8e8;line-height:1.7;letter-spacing:.01em}
.deep-credit b{color:var(--green);font-weight:500}
.deep-warn{margin-top:14px;padding:14px 18px;background:rgba(255,98,0,.05);border-left:3px solid var(--orange);border-radius:6px;font-size:12px;color:var(--gray);line-height:1.7;font-style:italic}
.deep-warn b{color:var(--orange);font-style:normal}
.deep-related-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:18px}
.deep-related-link{background:var(--surface);border:1px solid var(--bord2);border-radius:10px;padding:14px 18px;text-decoration:none;color:var(--white);font-size:13px;letter-spacing:.02em;transition:all .2s;display:flex;align-items:center;gap:10px}
.deep-related-link:hover{border-color:var(--orange);color:var(--orange)}
.deep-related-link::after{content:'→';margin-left:auto;color:var(--gray);transition:color .2s,transform .2s}
.deep-related-link:hover::after{color:var(--orange);transform:translateX(4px)}
.deep-brand-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:18px}
@media(max-width:780px){.deep-tdr-grid{grid-template-columns:repeat(2,1fr)}.deep-related-grid{grid-template-columns:1fr}}
.related-link{display:flex;align-items:center;gap:10px}
.related-link{background:var(--surface);border:1px solid var(--bord2);border-radius:10px;padding:14px 18px;text-decoration:none;color:var(--white);font-size:13px;letter-spacing:.02em;transition:all .2s}
.related-link:hover{border-color:var(--orange);color:var(--orange)}
.related-link::after{content:'→';margin-left:auto;color:var(--gray)}
</style>

<div class="deep-section">
<div class="deep-section-label">${city.name}, ${city.state} · Local Context</div>
<h2 style="font-family:var(--block);font-size:clamp(28px,5vw,40px);letter-spacing:.04em;line-height:1.1;margin-bottom:18px;color:var(--white)">Serving ${city.name} &amp; Surrounding Areas</h2>
<p class="deep-prose">${city.localContext} We cover ${city.name} and nearby ${city.nearby} — the diagnostic process is the same wherever you are in the ${city.region} service area.</p>
<div class="deep-quick"><p>If your appliance is broken in ${city.name}, here's how we handle it: <strong>chat with Ant 🐜 on our homepage</strong>, share a quick video and your model number photo, and a real technician builds a Technician Decision Report with four honest options and real pricing. The $50 Quick Check or $100 in-home diagnostic credits directly toward your repair labor if you proceed — you never pay twice.</p></div>
</div>

<div class="deep-section">
<div class="deep-section-label">Common Repairs in ${city.name}</div>
<h2 style="font-family:var(--block);font-size:clamp(28px,5vw,40px);letter-spacing:.04em;line-height:1.1;margin-bottom:18px;color:var(--white)">What We Fix Most Often Locally</h2>
<p class="deep-prose">These are the most common appliance failures we see in ${city.name} and the surrounding ${city.region} market. Each links to a deep page with causes, pricing, and the 4-option TDR for that specific symptom.</p>
<div class="deep-related-grid">${symptomLinks}</div>
</div>

<div class="deep-section">
<div class="deep-section-label">Is It Worth Fixing?</div>
<h2 style="font-family:var(--block);font-size:clamp(28px,5vw,40px);letter-spacing:.04em;line-height:1.1;margin-bottom:18px;color:var(--white)">Our Philosophy in ${city.name}</h2>
<p class="deep-prose"><strong>Parts availability and labor complexity matter more than age.</strong> A well-built 12-year-old appliance with an available part is often worth fixing twice. A newer unit with a discontinued board is the harder call. Older machines were often built better — and our techs in the ${city.region} area know which platforms hold up and which ones don't.</p>
<p class="deep-prose">Try the <a href="/should-i-repair-or-replace">replacement calculator</a> for a quick framing, but every situation is different. The Technician Decision Report gives you the real numbers on your specific machine — not a generic age formula.</p>
</div>

<div class="deep-section">
<div class="deep-section-label">The TDR — Four Honest Options</div>
<h2 style="font-family:var(--block);font-size:clamp(28px,5vw,40px);letter-spacing:.04em;line-height:1.1;margin-bottom:18px;color:var(--white)">How a Real Diagnosis Works</h2>
<p class="deep-prose">After your Quick Check or in-home diagnostic, a real technician reviews your model, video, and symptoms. They build a Technician Decision Report with four options — you pick which one works for you.</p>
<div class="deep-tdr-grid">
<div class="deep-tdr-card"><div class="deep-tdr-num">Option 1</div><div class="deep-tdr-name">OEM Part Only</div><div class="deep-tdr-desc">We source the exact OEM part and ship directly to you. You install. Best for confident DIYers.</div></div>
<div class="deep-tdr-card"><div class="deep-tdr-num">Option 2</div><div class="deep-tdr-name">Amazon Equivalent</div><div class="deep-tdr-desc">We source a verified compatible part at a lower price. We ship; you install.</div></div>
<div class="deep-tdr-card"><div class="deep-tdr-num">Option 3</div><div class="deep-tdr-name">OEM + Labor</div><div class="deep-tdr-desc">We source the OEM part, ship it, and our technician installs it. Best when fit or access is complex.</div></div>
<div class="deep-tdr-card"><div class="deep-tdr-num">Option 4</div><div class="deep-tdr-name">Equivalent + Labor</div><div class="deep-tdr-desc">We source the equivalent, ship, and install. Balances cost and convenience.</div></div>
</div>
<div class="deep-warn"><b>Important if you choose labor:</b> do not start the job yourself. Once an appliance has been opened or partially worked on, our technician may need to charge additional labor — or may decline to take over the repair.</div>
<div class="deep-credit"><b>Your diagnostic fee is never wasted.</b> Every dollar you spend on the Quick Check ($50) or in-home diagnostic ($100) goes directly toward your repair labor if you decide to move forward. You're not paying for a diagnosis AND a repair — you're paying for a diagnosis that becomes a credit toward your repair. No double paying, ever.</div>
</div>

<div class="deep-section">
<div class="deep-section-label">By Brand</div>
<h2 style="font-family:var(--block);font-size:clamp(28px,5vw,40px);letter-spacing:.04em;line-height:1.1;margin-bottom:18px;color:var(--white)">Brands We Repair in ${city.name}</h2>
<p class="deep-prose">We service every major appliance brand in the ${city.region} area. Brand-specific pages cover common failures, parts availability, and the diagnostic approach for each platform.</p>
<div class="deep-brand-grid">${brandLinks}</div>
</div>

<div class="deep-section">
<div class="deep-section-label">${city.name} FAQ Addendum</div>
<h2 style="font-family:var(--block);font-size:clamp(28px,5vw,40px);letter-spacing:.04em;line-height:1.1;margin-bottom:18px;color:var(--white)">More Questions</h2>
<div style="display:flex;flex-direction:column;gap:10px;margin-top:20px">
<div style="background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px"><div style="font-size:14px;color:var(--white);font-weight:500;margin-bottom:10px">Do I have to pay the diagnostic fee AND the repair cost?</div><div style="font-size:13px;color:var(--gray);line-height:1.75">No. Your $50 Quick Check or $100 in-home diagnostic applies directly to repair labor if you proceed. You only pay once.</div></div>
<div style="background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px"><div style="font-size:14px;color:var(--white);font-weight:500;margin-bottom:10px">Should I repair or replace my appliance in ${city.name}?</div><div style="font-size:13px;color:var(--gray);line-height:1.75">It depends on parts availability, labor complexity, and what's broken — not just age. Try the <a href="/should-i-repair-or-replace" style="color:var(--orange);text-decoration:none;border-bottom:1px solid rgba(255,98,0,.3)">replacement calculator</a> for a quick framing, then chat with Ant for the real technician's opinion on your specific machine.</div></div>
<div style="background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px"><div style="font-size:14px;color:var(--white);font-weight:500;margin-bottom:10px">What if I want to do the repair myself?</div><div style="font-size:13px;color:var(--gray);line-height:1.75">Option 1 and Option 2 of the TDR are for you. We source the right part with our diagnosis and ship it directly to your door — no part-number hunting. Just don't start the job before getting the TDR; if you ask us to take over after opening the appliance, the technician may charge additional labor or decline.</div></div>
<div style="background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px"><div style="font-size:14px;color:var(--white);font-weight:500;margin-bottom:10px">Do you share part numbers?</div><div style="font-size:13px;color:var(--gray);line-height:1.75">No — we source and ship the part directly. We've found that sharing part numbers leads to wrong-part returns, re-diagnosis, and customer frustration. Our parts come with our backing and the diagnostic credit already applied.</div></div>
</div>
</div>
${SENTINEL_CLOSE}
`;
}

function deepen(city) {
  const fp = path.join(REPO, `${city.slug}.html`);
  if (!fs.existsSync(fp)) {
    console.log(`SKIP  ${city.slug} (file not found)`);
    return false;
  }
  let html = fs.readFileSync(fp, "utf8");

  // Idempotency — skip if already deepened.
  if (html.includes(SENTINEL_OPEN)) {
    // Remove old block and rewrite — keeps script idempotent across re-runs.
    const re = new RegExp(`${SENTINEL_OPEN}[\\s\\S]*?${SENTINEL_CLOSE}\\s*`, "g");
    html = html.replace(re, "");
  }

  const block = buildDeepenBlock(city);

  // Insert BEFORE the CTA section. Match the standard pattern used in city pages.
  const ctaMarker = `<div class="cta-section">`;
  const idx = html.indexOf(ctaMarker);
  if (idx === -1) {
    console.log(`WARN  ${city.slug} — no cta-section marker found, skipping`);
    return false;
  }
  const before = html.slice(0, idx);
  const after = html.slice(idx);
  const out = before + block + "\n" + after;

  fs.writeFileSync(fp, out, "utf8");
  console.log(`DEEPENED  ${city.slug}.html`);
  return true;
}

let count = 0;
for (const c of CITIES) {
  if (deepen(c)) count++;
}
console.log(`\nTotal city pages deepened: ${count}`);
