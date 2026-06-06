#!/usr/bin/env node
// Generates per-zip SEO landing pages from the service_zone table.
// Each page: <zip>-appliance-repair.html with city + market specifics.
// Idempotent — re-running updates existing pages.
//
// Usage: node colony-loop/scripts/generate-seo-landers.js [--dry-run]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const DRY_RUN = process.argv.includes('--dry-run');

function pageTemplate({ zip, city, state, market }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Appliance Repair in ${city}, ${state} ${zip} | TN Appliance Exchange</title>
<meta name="description" content="Fast appliance repair in ${city}, ${state} ${zip}. Same-day service. Washers, dryers, refrigerators, dishwashers, ranges. Call 866-268-0111.">
<link rel="canonical" href="https://tnapplianceexchange.net/${zip}-appliance-repair.html">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 30px 18px; line-height: 1.6; color: #1a1f2c; }
  h1 { font-size: 32px; margin-bottom: 8px; }
  .sub { color: #6b7280; margin-bottom: 24px; }
  h2 { font-size: 20px; margin-top: 32px; margin-bottom: 8px; }
  .cta { display: inline-block; background: #ff8a00; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; margin: 12px 0; }
  ul { padding-left: 22px; }
  .ant { font-size: 24px; }
</style>
</head>
<body>

<div class="ant">🐜</div>
<h1>Appliance Repair in ${city}, ${state}</h1>
<p class="sub">Zip ${zip} · ${market} market · TN Appliance Exchange LLC</p>

<a class="cta" href="tel:+18662680111">📞 Call 866-268-0111</a>
<a class="cta" href="quote.html" style="background:white;color:#ff8a00;border:2px solid #ff8a00">Get a quote</a>

<h2>What we repair in ${city}</h2>
<ul>
  <li>Refrigerators + freezers (Whirlpool, GE, LG, Samsung, Frigidaire, KitchenAid)</li>
  <li>Washers + dryers (front-load, top-load, stackable)</li>
  <li>Dishwashers (built-in, portable)</li>
  <li>Ranges, ovens, cooktops (gas + electric)</li>
  <li>Microwaves (countertop, over-range)</li>
  <li>HVAC service (heat pump, furnace, AC)</li>
</ul>

<h2>Why ${city} chooses TN Appliance Exchange</h2>
<ul>
  <li>Same-day + next-day appointments available</li>
  <li>Local techs based in the ${market} area</li>
  <li>Real diagnostic + transparent estimate before repair</li>
  <li>Accept most home warranty companies (AHS, Frontdoor, Choice)</li>
  <li>1-year service warranty on our repairs</li>
</ul>

<h2>Schedule online</h2>
<a class="cta" href="customer-portal.html">View your appointment</a>
<a class="cta" href="service-area.html" style="background:white;color:#ff8a00;border:2px solid #ff8a00">See all our zip codes</a>

<p style="margin-top:48px;color:#6b7280;font-size:12px">
  TN Appliance Exchange LLC · Owner: James "Teddy" Pivacek<br>
  Service zone ${zip} (${city}, ${state} - ${market} market) updated ${new Date().toISOString().slice(0,10)}.<br>
  🐜 ANT
</p>

</body>
</html>`;
}

async function main() {
  console.log(`[seo-landers] start dry_run=${DRY_RUN}`);
  let zones = [];
  try {
    const res = await fetch(`${XANO}/list_service_zones?accepting_only=true`);
    const data = await res.json();
    zones = (data && data.zones) || [];
  } catch (err) {
    console.error('[seo-landers] zone fetch failed:', err.message);
    process.exit(1);
  }

  console.log(`[seo-landers] ${zones.length} zones`);
  let written = 0;
  for (const z of zones) {
    const zip = String(z.zip_code || '').trim();
    const city = String(z.zone || z.market || '').trim() || 'your area';
    const state = String(z.state || '').trim().toUpperCase() || 'TN';
    const market = String(z.market || '').trim() || city;
    if (!zip) continue;

    const html = pageTemplate({ zip, city, state, market });
    const out = path.join(REPO_ROOT, `${zip}-appliance-repair.html`);

    if (DRY_RUN) {
      console.log(`[dry-run] would write ${out} (${html.length} bytes)`);
    } else {
      await fs.writeFile(out, html);
      written++;
      if (written % 10 === 0) console.log(`[seo-landers] wrote ${written} so far`);
    }
  }
  console.log(`[seo-landers] done — ${DRY_RUN ? 'dry-run' : written + ' files written'}`);
}

main().catch(err => {
  console.error('[seo-landers] fatal:', err);
  process.exit(1);
});
