#!/usr/bin/env node
// Rebuild sitemap.xml from data files + existing city slugs.
// Organized by category for Google Search Console clarity.

const fs = require("fs");
const path = require("path");
const symptoms = require("./symptoms-data.js");
const brands = require("./brands-data.js");

const SITE = "https://tnapplianceexchange.net";
const REPO = path.resolve(__dirname, "../..");

// City slug list — must mirror existing files at repo root.
const CITY_SLUGS = [
  // TN
  "nashville","murfreesboro","antioch","clarksville","brentwood","franklin",
  "hermitage","hendersonville","gallatin","smyrna","la-vergne","lebanon",
  "mt-juliet","nolensville","spring-hill","ashland-city","kingston-springs","pleasant-view",
  // LA
  "baton-rouge","new-orleans","hammond","metairie","kenner","chalmette","slidell",
  "mandeville","covington","walker","denham-springs","gonzales","prairieville",
  "madisonville","ponchatoula","abita-springs","pearl-river","laplace","pumpkin-center"
];

// Priority by tier.
function entry(slug, priority, changefreq = "monthly") {
  return `  <url>
    <loc>${SITE}/${slug}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

const today = new Date().toISOString().slice(0, 10);

const sections = [];

// Root + key landing pages — highest priority.
sections.push(`  <!-- Main pages -->`);
sections.push(`  <url>
    <loc>${SITE}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`);
sections.push(entry("how-it-works", "0.95"));
sections.push(entry("appliance-ant", "0.95"));
sections.push(entry("should-i-repair-or-replace", "0.9"));
sections.push(entry("repairs-directory.html", "0.7", "weekly"));
sections.push(entry("privacy", "0.3"));
sections.push(entry("terms", "0.3"));

// Language homepages (multilingual front doors).
sections.push(`\n  <!-- Language homepages -->`);
["es", "vi", "ar", "hi", "fr"].forEach((l) => sections.push(entry(l + "/", "0.8", "weekly")));

// Hub pages — high priority category landings.
sections.push(`\n  <!-- Category hub pages -->`);
["dryer-repair","washer-repair","refrigerator-repair","dishwasher-repair","oven-repair"].forEach(s => {
  sections.push(entry(s, "0.95", "weekly"));
});

// Dryer vent cleaning — the market we're pushing hard (TN main + LA cluster).
sections.push(`\n  <!-- Dryer vent cleaning -->`);
sections.push(entry("dryer-vent-cleaning.html", "0.95", "weekly"));
sections.push(entry("dryer-vent-cleaning-tennessee.html", "0.9", "weekly"));
sections.push(entry("dryer-vent-cleaning-louisiana.html", "0.9", "weekly"));
["murfreesboro","smyrna","la-vergne","franklin","brentwood","spring-hill","antioch","mt-juliet","lebanon","hendersonville","gallatin","clarksville",
 "new-orleans","metairie","kenner","chalmette","hammond","mandeville","covington","ponchatoula","slidell","baton-rouge","denham-springs","gonzales"].forEach(s => {
  sections.push(entry("dryer-vent-cleaning-" + s + ".html", "0.85", "weekly"));
});

// Symptom pages — high priority informational/conversion.
sections.push(`\n  <!-- Symptom pages -->`);
symptoms.forEach(s => {
  sections.push(entry(s.slug, "0.85"));
});

// Brand pages — high priority informational/conversion.
sections.push(`\n  <!-- Brand pages -->`);
brands.forEach(b => {
  // Scope-specific (e.g. samsung-washer-repair) gets slightly lower priority than whole-line.
  const pri = b.scope === "all" ? "0.85" : "0.8";
  sections.push(entry(b.slug, pri));
});

// City pages — tiered priority by market size.
const cityPriority = {
  // Tier 1 - flagship markets
  "nashville": "0.9","murfreesboro": "0.9","antioch": "0.9","clarksville": "0.9",
  "new-orleans": "0.9","baton-rouge": "0.9","hammond": "0.9",
  // Tier 2 - major suburbs
  "brentwood": "0.85","franklin": "0.85","hermitage": "0.8","hendersonville": "0.8",
  "gallatin": "0.8","smyrna": "0.8","la-vergne": "0.8","lebanon": "0.8",
  "mt-juliet": "0.8","nolensville": "0.8","spring-hill": "0.8",
  "metairie": "0.8","kenner": "0.8","slidell": "0.8","mandeville": "0.8",
  "covington": "0.8","walker": "0.8","denham-springs": "0.8",
  // Tier 3 - smaller markets
  "ashland-city": "0.75","kingston-springs": "0.75","pleasant-view": "0.75",
  "chalmette": "0.75","gonzales": "0.75","prairieville": "0.75","madisonville": "0.75",
  "ponchatoula": "0.75","abita-springs": "0.75","pearl-river": "0.75","laplace": "0.75",
  "pumpkin-center": "0.7"
};

sections.push(`\n  <!-- City service-area pages -->`);
CITY_SLUGS.forEach(slug => {
  const pri = cityPriority[slug] || "0.7";
  sections.push(entry(slug, pri));
});

// Long-tail city × brand × appliance pages — the deep inventory. Read from the
// filesystem so the sitemap always matches what's actually published. Uses the
// real .html filename (matches each page's canonical). Admin/tool pages are
// never globbed here — only the -repair- long-tail set.
sections.push(`\n  <!-- City x brand x appliance pages -->`);
fs.readdirSync(REPO)
  .filter(f => /-repair-[a-z-]+\.html$/.test(f) && !/^should-i/.test(f))
  .sort()
  .forEach(f => sections.push(entry(f, "0.7")));

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

${sections.join("\n")}

</urlset>
`;

fs.writeFileSync(path.join(REPO, "sitemap.xml"), xml, "utf8");

const urlCount = (xml.match(/<url>/g) || []).length;
console.log(`Wrote sitemap.xml — ${urlCount} URLs`);
