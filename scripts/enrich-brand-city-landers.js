#!/usr/bin/env node
/* enrich-brand-city-landers — de-thin the {brand}-{appliance}-repair-{city} landers.
 *
 * These 175 pages ranked page 3-5 (or 0 impressions) because they were near-duplicates:
 * identical body copy across brands and across cities, and titles with no CTR hook. This
 * script rewrites each page's SERP snippet (title/meta/OG/twitter) with the same 4.5-star
 * proof + "text you right back" hook that's winning on the city hubs, AND injects genuinely
 * UNIQUE content on two axes so no two pages are duplicates:
 *   - brand x appliance: the real common failures + typical parts for THAT combo (35 combos)
 *   - city: real local context (housing stock, climate, base/rental turnover) for the 5 cities
 *
 * Idempotent: guards on <!-- UNIQUE-ENRICH --> so re-runs don't double-inject; re-runs still
 * refresh the title/meta. DRY_RUN=1 prints what would change without writing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DRY = process.env.DRY_RUN === '1';

const BRANDS = ['whirlpool', 'samsung', 'lg', 'ge', 'maytag', 'frigidaire', 'kenmore'];
const APPLIANCES = ['refrigerator', 'washer', 'dryer', 'dishwasher', 'oven'];
const CITIES = ['nashville', 'murfreesboro', 'clarksville', 'brentwood', 'mandeville'];

const BRAND_CAP = { whirlpool: 'Whirlpool', samsung: 'Samsung', lg: 'LG', ge: 'GE', maytag: 'Maytag', frigidaire: 'Frigidaire', kenmore: 'Kenmore' };
const APP_LABEL = { refrigerator: 'Refrigerator', washer: 'Washer', dryer: 'Dryer', dishwasher: 'Dishwasher', oven: 'Oven' };

// ── CITY CONTEXT (real, differentiated) ──────────────────────────────────────
const CITY = {
  nashville:    { name: 'Nashville', st: 'TN', county: 'Davidson County',
    ctx: "Nashville homes run the gamut — century-old bungalows in East Nashville and Germantown with well-worn appliances, and fast-turnover rentals and short-term stays where a dead fridge can't wait. We diagnose over video first so you're not stuck a week for a truck." },
  murfreesboro: { name: 'Murfreesboro', st: 'TN', county: 'Rutherford County',
    ctx: "Murfreesboro is one of the fastest-growing cities in Tennessee, so a lot of the appliances we see are builder-grade units hitting the 5-8 year failure window all at once, plus heavy rental turnover around MTSU. We tell you straight whether it's worth fixing or replacing." },
  clarksville:  { name: 'Clarksville', st: 'TN', county: 'Montgomery County',
    ctx: "With Fort Campbell next door, Clarksville sees constant PCS moves and rental turnover — appliances that need a fast, honest diagnosis on a tight timeline before a move-out or move-in. Our video Quick Check gets you an answer in hours, not days." },
  brentwood:    { name: 'Brentwood', st: 'TN', county: 'Williamson County',
    ctx: "Brentwood homes lean toward premium, built-in appliances where a misdiagnosis gets expensive fast. We confirm the exact failed part before anyone quotes you a board or a compressor, so you don't overpay for a guess." },
  mandeville:   { name: 'Mandeville', st: 'LA', county: 'St. Tammany Parish',
    ctx: "On the Northshore, humidity and hard water are tough on ice makers, sealed systems, and dishwasher pumps. We see the local failure patterns constantly and price the fix honestly — OEM or quality aftermarket, your call." },
};

// ── BRAND x APPLIANCE knowledge (real failures + parts) ──────────────────────
// note: 1-2 sentence brand+appliance framing.  failures: 3-4 specific "what fails + the part".
// metaHook: short phrase for the meta description.  Every combo is distinct.
const BA = {
  refrigerator: {
    whirlpool:  { hook: 'the defrost-system + evaporator-fan failures', note: "Whirlpool fridges (and their Maytag/Amana siblings) are among the most repairable on the market — parts are everywhere and the failure points are well-known.",
      failures: ['Defrost system — heater, bi-metal thermostat, or the adaptive defrost control — causing the classic "freezer cold, fridge warm."', 'Evaporator fan motor gone noisy or dead, so cold air never reaches the fresh-food side.', 'Icemaker module or water inlet valve — no ice or water pooling under the drawer.'] },
    samsung:    { hook: 'the notorious ice-maker + Twin-Cooling issues', note: "Samsung refrigerators are feature-loaded but the ice maker is a known weak point. Pinpointing the exact part up front saves a wasted service call.",
      failures: ['Ice maker frosting/jamming (the famous DA97 auger + fan-duct icing) — often a full ice-maker assembly.', 'Twin-Cooling evaporator freezing over behind the back panel — warm fridge with a 22C/39E-style code.', 'Main PCB or fan relay causing intermittent cooling that "comes and goes."'] },
    lg:         { hook: 'the linear-compressor + sealed-system diagnosis', note: "LG's linear-compressor design means an accurate diagnosis is everything — the sealed system is often covered under LG's 10-year compressor warranty, so you don't want a shop guessing.",
      failures: ['Linear compressor / sealed-system failure — fresh food and freezer both slowly warming (frequently warranty-covered; we confirm before you pay).', 'Evaporator fan or defrost sensor icing the coil.', 'Main control board on French-door models throwing intermittent cooling faults.'] },
    ge:         { hook: 'the main-board + evaporator-fan failures', note: "GE and Hotpoint refrigerators are common and well-documented — we usually know the likely culprit before a truck ever rolls.",
      failures: ['Main control board (the WR55X-series boards) — the frequent cause of "stopped cooling" on French-door models.', 'Evaporator fan motor or defrost heater leaving the fresh-food side warm.', 'Water inlet valve or icemaker for no-ice/leak complaints.'] },
    maytag:     { hook: 'the defrost + evaporator-fan failures', note: "Maytag refrigerators are built on the Whirlpool platform, so parts are fast to source and repairs are clean.",
      failures: ['Defrost heater or thermostat — the "freezer fine, fridge warm" pattern Whirlpool-family units are known for.', 'Evaporator fan motor gone loud or dead.', 'Icemaker assembly or inlet valve for no-ice and leaks.'] },
    frigidaire: { hook: 'the defrost-drain + evaporator-fan failures', note: "Frigidaire (Electrolux) refrigerators have a handful of very common failure points we see constantly and price honestly.",
      failures: ['Defrost drain freezing up and dumping water on the floor — a classic Frigidaire complaint.', 'Evaporator fan motor or defrost heater leaving the fresh-food side warm.', 'Main control board on side-by-sides throwing cooling faults.'] },
    kenmore:    { hook: 'the model-number-specific diagnosis', note: "Kenmore refrigerators are built by Whirlpool, LG, or Frigidaire depending on the model, so the model number is everything — which is exactly what our video Quick Check confirms first.",
      failures: ['Defrost system or evaporator fan (Whirlpool-built models) — "freezer cold, fridge warm."', 'Sealed system or compressor (LG-built models) — both compartments slowly warming.', 'Icemaker or inlet valve across all builds for no-ice/leaks.'] },
  },
  washer: {
    whirlpool:  { hook: 'the direct-drive coupler + drain-pump fixes', note: "Whirlpool washers are one of the most repair-friendly platforms out there — most fixes are cheap once the failed part is confirmed.",
      failures: ['Direct-drive motor coupler sheared (the classic top-loader failure — a cheap, sacrificial part).', 'Drain pump clogged or failed — water left standing in the tub.', 'Lid switch / lid lock stopping the spin cycle.'] },
    samsung:    { hook: 'the drain-pump + bearing fixes and error codes', note: "Samsung washers throw cryptic error codes without brand-specific knowledge — we read them fast and get you the real cause.",
      failures: ['Drain pump failure (5E/SC code) — the most common Samsung front-loader complaint.', 'Fill/level issues (4E, SUD) from a valve or pressure sensor.', 'Tub bearing wear (VRT models) causing loud spin and walk.'] },
    lg:         { hook: 'the direct-drive + drain/unbalance fixes', note: "LG's direct-drive washers are reliable but throw specific codes (OE, UE, LE) that point straight to the part.",
      failures: ['OE drain error — pump or drain hose blockage leaving standing water.', 'UE unbalance / worn suspension causing violent shake on spin.', 'LE motor / Hall sensor fault stopping the wash.'] },
    ge:         { hook: 'the drain-pump + bearing fixes', note: "GE washers (top-load and front-load) are common and well-documented — we usually know the culprit before the visit.",
      failures: ['Drain pump failure leaving water in the tub.', 'Front-load tub bearing wear — loud, grinding spin.', 'Lid lock / door latch stopping the cycle.'] },
    maytag:     { hook: 'the lid-lock / actuator + bearing fixes', note: "Maytag washers (Bravos/Centennial, Whirlpool-built) share parts with Whirlpool, so sourcing is fast.",
      failures: ['Lid lock or shift actuator fault stopping the spin (very common on Bravos/Centennial).', 'Drain pump clogged or failed.', 'Tub bearing wear causing loud spin.'] },
    frigidaire: { hook: 'the door-lock + drain-pump fixes', note: "Frigidaire (Electrolux) front-loaders have a few very common failure points we price honestly.",
      failures: ['Door lock assembly failing to latch — the washer won’t start.', 'Drain pump blockage or failure.', 'Worn tub bearing / spider on older front-loaders.'] },
    kenmore:    { hook: 'the model-specific drain + lock fixes', note: "Kenmore washers are built by Whirlpool, LG, or Frigidaire — the model number tells us the platform and the right part.",
      failures: ['Drain pump failure (all builds) — standing water in the tub.', 'Lid lock / door latch faults stopping the cycle.', 'Direct-drive coupler (Whirlpool-built) or suspension (LG-built) on spin problems.'] },
  },
  dryer: {
    whirlpool:  { hook: 'the airflow + heating-element fixes', note: "Whirlpool/Maytag dryers trip thermal fuses reliably when airflow is restricted — often the dryer is doing its job and the vent is the real problem.",
      failures: ['Blown thermal fuse from a clogged vent line (the dryer protecting itself — we clear the cause, not just swap the part).', 'Heating element or high-limit thermostat — no heat, clothes still damp.', 'Worn drum rollers or belt causing thumping/squealing.'] },
    samsung:    { hook: 'the heating-element + thermistor fixes', note: "Samsung dryers throw HE/heat codes that point to the element or sensor — we confirm before ordering.",
      failures: ['Heating element failure (HE code) — no heat.', 'Thermistor / thermostat reading wrong and cutting heat early.', 'Drum roller or idler pulley squealing.'] },
    lg:         { hook: 'the heating-element + flow-sensor fixes', note: "LG dryers use a sensor bar and flow logic (d80/d90/d95) that flags airflow before you lose heat entirely.",
      failures: ['Heating element or thermistor — no heat / long dry times.', 'd80/d90/d95 flow warnings from a restricted vent.', 'Roller / belt wear causing noise.'] },
    ge:         { hook: 'the heating-coil + belt fixes', note: "GE dryers are simple and well-documented — coil and belt jobs are quick.",
      failures: ['Heating coil / element failure — no heat.', 'Broken drive belt — drum won’t turn.', 'Drum bearing or glides worn, causing a rumble.'] },
    maytag:     { hook: 'the airflow + heating-element fixes', note: "Maytag dryers (Whirlpool-built) share the same reliable airflow-protection design and parts.",
      failures: ['Thermal fuse blown from restricted venting.', 'Heating element or thermostat — no heat.', 'Rollers / belt worn, causing thumping.'] },
    frigidaire: { hook: 'the heating-element + limiter fixes', note: "Frigidaire dryers have a small set of very common no-heat causes we see constantly.",
      failures: ['Heating element or thermal limiter — no heat.', 'Drive belt broken — drum won’t tumble.', 'Blower or vent restriction extending dry times.'] },
    kenmore:    { hook: 'the heating + airflow fixes', note: "Kenmore dryers are Whirlpool- or LG-built; the model number tells us the exact element and fuse.",
      failures: ['Heating element / thermal fuse — no heat (frequently a vent-airflow cause).', 'Belt or roller wear causing noise.', 'Thermistor faults cutting cycles short.'] },
  },
  dishwasher: {
    whirlpool:  { hook: 'the control-board + drain-pump fixes', note: "Whirlpool dishwashers have a few well-known failure points and improved replacement boards.",
      failures: ['Control-board moisture damage on older units — dead panel or random cycling (the newer boards are improved).', 'Drain pump clogged or failed — standing water in the tub.', 'Heating element out — dishes not drying.'] },
    samsung:    { hook: 'the leak-sensor + drain fixes', note: "Samsung dishwashers flag leaks and drain faults with specific codes we read fast.",
      failures: ['LC / leak-sensor trip in the base tray — the classic Samsung complaint.', 'OE / 5E drain fault — pump or hose blockage.', 'Sump / case-front assembly leaks.'] },
    lg:         { hook: 'the drain-motor + spray-arm fixes', note: "LG dishwashers use direct-drive wash motors and OE/LE codes that point to the part.",
      failures: ['OE drain error — pump or check-valve blockage.', 'LE wash-motor fault — poor cleaning or dead cycle.', 'Spray-arm or inlet-valve issues leaving dishes dirty.'] },
    ge:         { hook: 'the drain-pump + control fixes', note: "GE dishwashers are common and the failure points are well-documented.",
      failures: ['Drain pump failure — water left in the tub.', 'Control board or touch panel unresponsive.', 'Wash-motor or spray-arm blockage leaving dishes dirty.'] },
    maytag:     { hook: 'the control + drain-pump fixes', note: "Maytag dishwashers (Whirlpool-built) share parts and the same known board/drain fixes.",
      failures: ['Control-board fault causing dead panel or random cycles.', 'Drain pump clogged or failed.', 'Heating element out — no dry.'] },
    frigidaire: { hook: 'the drain + door-latch fixes', note: "Frigidaire dishwashers have a short list of very common, honestly-priced failures.",
      failures: ['Drain pump or check valve blockage — standing water.', 'Door latch / switch failing to start the cycle.', 'Control board or wash-motor faults.'] },
    kenmore:    { hook: 'the model-specific drain + control fixes', note: "Kenmore dishwashers are Whirlpool- or LG-built — the model number pins the exact pump and board.",
      failures: ['Drain pump failure (all builds) — standing water.', 'Control board or panel faults.', 'Wash-motor / spray-arm issues leaving dishes dirty.'] },
  },
  oven: {
    whirlpool:  { hook: 'the bake-element + igniter fixes', note: "Whirlpool/Maytag ranges are straightforward — element and igniter jobs are clean and well-documented.",
      failures: ['Bake or broil element burned out (electric) — no or uneven heat.', 'Weak oven igniter (gas) — glows but won’t open the gas valve, common at 5-10 years.', 'Oven temp sensor or control board reading wrong / F-codes.'] },
    samsung:    { hook: 'the control-board + element fixes', note: "Samsung ranges lean on the control board and touch panel — we confirm the exact fault before quoting.",
      failures: ['Control board or touch panel fault (button/C-d0-style errors).', 'Bake element or dual-fuel igniter — no heat.', 'Temp sensor drift causing uneven baking.'] },
    lg:         { hook: 'the element + control fixes', note: "LG ranges throw F9/F19-style codes that point straight to the heat circuit.",
      failures: ['Bake/broil element failure — no or slow heat (F9/F19).', 'Oven temp sensor out of range.', 'Control board fault on the touch models.'] },
    ge:         { hook: 'the igniter + bake-element fixes', note: "GE ranges are common and the igniter/element jobs are quick and well-priced.",
      failures: ['Oven igniter (gas) weak — glows but won’t reach temp to open the valve.', 'Bake element burned out (electric).', 'WB-series control board or temp sensor fault.'] },
    maytag:     { hook: 'the bake-element + igniter fixes', note: "Maytag ranges (Whirlpool-built) share the same reliable element and igniter parts.",
      failures: ['Bake or broil element out (electric).', 'Oven igniter weak (gas) — won’t reach temp.', 'Temp sensor or control board F-codes.'] },
    frigidaire: { hook: 'the element + igniter fixes', note: "Frigidaire ranges have a handful of very common heat-circuit failures we price honestly.",
      failures: ['Bake/broil element burned out (electric).', 'Oven igniter weak (gas).', 'Control board or temp sensor fault causing wrong temps.'] },
    kenmore:    { hook: 'the model-specific heat-circuit fixes', note: "Kenmore ranges are Whirlpool-, GE-, or Frigidaire-built — the model number tells us the exact element and igniter.",
      failures: ['Bake element or oven igniter (by build) — no heat.', 'Temp sensor drift — uneven baking.', 'Control board faults / F-codes.'] },
  },
};

function parse(file) {
  const m = file.match(/^([a-z]+)-([a-z]+)-repair-([a-z]+)\.html$/);
  if (!m) return null;
  const [, brand, appliance, city] = m;
  if (!BRANDS.includes(brand) || !APPLIANCES.includes(appliance) || !CITIES.includes(city)) return null;
  return { brand, appliance, city };
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

let changed = 0, skipped = 0;
for (const file of fs.readdirSync(ROOT)) {
  const p = parse(file);
  if (!p) continue;
  const { brand, appliance, city } = p;
  const B = BRAND_CAP[brand], A = APP_LABEL[appliance], C = CITY[city], ba = BA[appliance][brand];
  const full = path.join(ROOT, file);
  let html = fs.readFileSync(full, 'utf8');
  const before = html;

  // ── (A) SERP snippet: title + meta + og + twitter ──
  const title = `${B} ${A} Repair in ${C.name}, ${C.st} — Same-Day, 4.5★`;
  const desc = `${B} ${A.toLowerCase()} repair in ${C.name}, ${C.st} — same-day, honest diagnosis. We know ${ba.hook} cold. Tell us what's wrong and we text you right back. 4.5★ from 1,000+ local customers, $50 video Quick Check credited to your repair.`;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(">)/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(">)/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);

  // ── (A2) Teddy's call: the AI page is the primary door. Point the "Book a Repair"
  //         CTA straight at the appliance AI (keeps brand/appliance/town context). ──
  html = html.replace(/href="\/book-repair\.html\?/g, 'href="/appliance-ai.html?');

  // ── (B1) replace the generic BRAND_NOTE line under the "Common problems" H2 with a
  //         brand x appliance x city specific intro ──
  const introUnique = `In ${C.name}, the ${B} ${A.toLowerCase()} problems we get called for most come down to ${ba.hook}. ${ba.note}`;
  html = html.replace(/(<h2>Common [\s\S]*?<\/h2>\s*)<p style="color:#aaa;margin-bottom:10px">[\s\S]*?<\/p>/,
    `$1<p style="color:#aaa;margin-bottom:10px">${esc(introUnique)}</p>`);

  // ── (B2) inject the unique brand x appliance failure block + city block, once, right
  //         before "How the $50 Quick Check works" ──
  if (!html.includes('<!-- UNIQUE-ENRICH -->')) {
    const failuresLi = ba.failures.map((f) => `<li>${esc(f)}</li>`).join('');
    const block = `<!-- UNIQUE-ENRICH -->
<h2>Typical ${esc(B)} ${esc(A.toLowerCase())} failures we confirm first</h2>
<ul>${failuresLi}</ul>
<p style="color:#888;font-size:13px">We confirm the exact failed part from your video + model number before anyone quotes you — so a ${esc(B.toLowerCase())} ${esc(A.toLowerCase())} repair in ${esc(C.name)} never turns into a guess-and-replace.</p>
<h2>${esc(A)} repair in ${esc(C.name)}, ${esc(C.st)}</h2>
<p style="color:#aaa;font-size:14px">${esc(C.ctx)} We serve ${esc(C.name)} and all of ${esc(C.county)}.</p>
<!-- /UNIQUE-ENRICH -->
`;
    if (/(<h2>How the \$50 Quick Check works<\/h2>)/.test(html)) {
      html = html.replace(/(<h2>How the \$50 Quick Check works<\/h2>)/, `${block}$1`);
    } else {
      // fallback: inject before the related-links section
      html = html.replace(/(<div class="rel">)/, `${block}$1`);
    }
  }

  // ── (B3) de-duplicate the JSON-LD LocalBusiness description string ──
  html = html.replace(/("description":")[^"]*?(TN Appliance Exchange"\})/,
    `$1${B} ${A} repair in ${C.name}, ${C.st} — same-day honest diagnosis by real local techs. 4.5-star rated. $2`);

  if (html === before) { skipped++; continue; }
  changed++;
  if (DRY) {
    if (changed <= 3) console.log(`\n=== ${file} ===\n  title: ${title}\n  intro: ${introUnique.slice(0, 90)}...\n  failures: ${ba.failures.length}`);
  } else {
    fs.writeFileSync(full, html);
  }
}
console.log(`\n${DRY ? '[DRY] would enrich' : 'enriched'} ${changed} brand-city landers${skipped ? `, ${skipped} unchanged` : ''}.`);
