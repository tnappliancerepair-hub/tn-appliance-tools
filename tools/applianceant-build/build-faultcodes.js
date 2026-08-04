#!/usr/bin/env node
/* Appliance Ant — FAULT-CODE page generator (applianceant.com).
 *
 * Wave 1 of the fault-code library. These are the highest-intent DIY searches in the
 * trade ("samsung washer 4c", "lg dryer d80", "whirlpool F3E1") — people already have a
 * wrench in hand. Each page is GROUNDED in the real curated fault-code corpus
 * (_lib/ant/fault-codes.json: meaning + likely causes + the confirming test) and layers
 * on the DIY + dual-buy commerce (genuine OEM through us / budget on Amazon) — the same
 * money loop as the symptom guides.
 *
 * Grounding rule: the core tech facts (what the code means, likely causes, the test) come
 * from the corpus, never invented. Bench notes are qualitative trade knowledge, never
 * fabricated stats.
 *
 * Run:  node tools/applianceant-build/build-faultcodes.js
 * (Run AFTER build-symptoms.js if you regenerate both — this MERGES into sitemap.xml so it
 *  won't clobber the symptom URLs, but build-symptoms.js rewrites the sitemap to symptoms
 *  only, so codes must be re-merged after.)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'applianceant');
const CORPUS = require(path.join(__dirname, '..', '..', 'netlify', 'functions', '_lib', 'ant', 'fault-codes.json'));
const AMAZON_TAG = 'tnappliance-20';
const REPAIR = 'https://tnapplianceexchange.net';
const LASTMOD = '2026-08-04';

// ---- helpers (shared with build-symptoms) ----------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amz = (terms) => `https://www.amazon.com/s?k=${encodeURIComponent(terms).replace(/%20/g, '+')}${AMAZON_TAG ? `&tag=${AMAZON_TAG}` : ''}`;
const orderOem = (partName, appliance, slug) => `/order-oem?part=${encodeURIComponent(partName)}&appliance=${encodeURIComponent(appliance)}&from=${slug}`;
const DIFF = { easy: ['Easy DIY', '#39ff14'], moderate: ['Moderate DIY', '#ff9d28'], pro: ['Call a pro', '#ff3b30'] };
const ICON = { Washer: '🌀', Dryer: '🔥', Refrigerator: '🧊', Dishwasher: '🍽️', Range: '🍳', Freezer: '❄️' };
const UNIVERSAL_TOOLS = [
  { name: 'Digital multimeter', why: 'Test a suspect part for continuity BEFORE you buy — the single best way to avoid replacing the wrong thing on a fault code.', terms: 'digital multimeter' },
  { name: 'Nut driver set (¼" + 5⁄16")', why: 'Most appliance panels are held on with ¼" and 5⁄16" hex screws.', terms: 'appliance nut driver set 1/4 5/16' },
  { name: 'Screwdriver set (Phillips/flat/Torx)', why: 'Covers the odd panel screw and the Torx fasteners many brands use.', terms: 'screwdriver set torx phillips flat' },
];

// ---- corpus lookup ---------------------------------------------------------
function corpus(family, appliance, code) {
  const appl = String(appliance).toLowerCase();
  const hit = CORPUS.codes.find((c) => c.family === family && c.appliance === appl && c.code === code);
  if (!hit) throw new Error(`corpus miss: ${family}/${appliance}/${code}`);
  return hit;
}
const tc = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase()); // light title-case for cause phrases

// ---- Wave 1: 24 highest-intent codes ---------------------------------------
// Each entry: corpus key (family/appliance/code) + authored DIY/commerce enrichment.
const CODES = [
  // ── Samsung ───────────────────────────────────────────────────────────────
  { family: 'samsung', appliance: 'Washer', code: '4C', brand: 'Samsung', display: '4C', alt: '4E',
    quick: "A Samsung 4C (older displays show 4E) means the washer started a cycle but not enough water reached the tub in time. Nine times out of ten on the bench it's the boring stuff — a closed supply valve, a kinked or frozen inlet hose, or a clogged inlet screen — not a broken part. Rule those out (all free) before you buy anything; the water inlet valve is the part only if the water's on and the screens are clear.",
    bench: "Check the free stuff first: turn both hot AND cold faucets fully on, and pull the inlet hoses to clear the little mesh screens where they meet the machine.",
    parts: [
      { free: true, name: 'No part — open the valves & clear the screens', note: 'Both faucets full-on, hoses not kinked/frozen, and the mesh inlet screens rinsed clear. This clears most 4C codes for free.' },
      { name: 'Water inlet valve', diff: 'moderate', price: '$25–55', terms: 'samsung washer water inlet valve', note: "Only if water's on and the screens are clean but it still won't fill. Match your exact model number." },
    ],
    safe: ['Turn both the hot and cold supply faucets fully open.', 'Unkink the fill hoses; in winter, check they aren\'t frozen.', 'Unscrew the hoses and rinse the small mesh inlet screens — a common silent clog.'],
    risk: ['Water inlet valve swap — doable with the power off and water shut off; expect a little water in the hoses.'],
    pro: ['A wiring/connector fault to the valve you can\'t trace, or a main-board fault.'],
    worth: "Almost always a cheap fix. The free checks clear most 4C codes; the valve is $25–55 and 30 minutes. No reason to replace a washer over a fill error.",
    faq: [
      { q: 'What does 4C mean on a Samsung washer?', a: 'A water-supply error — the washer didn\'t fill with enough water in time. Older Samsung displays show it as 4E. Usually a closed valve, kinked/frozen hose, or clogged inlet screen; sometimes a bad water inlet valve.' },
      { q: 'How do I fix a Samsung 4C code myself?', a: 'Turn both faucets fully on, straighten the fill hoses, then unscrew the hoses and rinse the mesh inlet screens. If water\'s flowing and screens are clear but it still won\'t fill, replace the water inlet valve.' },
      { q: 'Is 4C the same as 4E?', a: 'Yes — same water-supply fault, just shown differently. Newer Samsung panels use 4C, older ones use 4E.' },
    ],
    related: [['samsung-washer-5c', 'Samsung Washer 5C'], ['washer-not-draining', 'Washer Not Draining'], ['lg-washer-ie', 'LG Washer IE'] ] },

  { family: 'samsung', appliance: 'Washer', code: '5C', brand: 'Samsung', display: '5C', alt: '5E',
    quick: "A Samsung 5C (older: 5E) means the washer couldn't pump the water out in time. The number-one cause is a clogged debris filter (the little door at the bottom front) packed with lint, coins, and hair — a free clean that fixes most 5C codes. If the filter's clear and it still won't drain, the drain pump or a kinked drain hose is next.",
    bench: "Lay a towel down and open the debris filter at the bottom-front first — that's the fix on most 5C calls.",
    parts: [
      { free: true, name: 'No part — clean the debris filter', note: 'Bottom-front access door; twist the cap out (towel down, water spills). Clear lint, coins, and hair from the filter and the pump impeller behind it.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–70', terms: 'samsung washer drain pump', note: 'If the filter\'s clear but the pump only hums or is silent during drain. Buy for your exact model.' },
    ],
    safe: ['Open and clean the bottom-front debris filter (towel + shallow pan first).', 'Check the drain hose behind the washer for kinks and clogs at the standpipe.', 'Run a spin/drain-only cycle to confirm.'],
    risk: ['Drain pump replacement — doable with power off and water shut off; leftover water in the tub.'],
    pro: ['Water reaching the motor/control board, or a leak you can\'t trace.'],
    worth: "Very worth it — the filter clean is free and clears most 5C codes; a drain pump is $30–70 and about an hour versus $600+ for a new washer.",
    faq: [
      { q: 'What is a 5C error on a Samsung washer?', a: 'A drain error — the water didn\'t pump out in time (older displays show 5E). Most often a clogged debris filter; sometimes a failed drain pump or kinked drain hose.' },
      { q: 'Where is the filter on a Samsung washer?', a: 'Behind a small access door at the bottom-front. Twist the cap counter-clockwise — keep a towel and pan ready, water will come out.' },
      { q: 'Why does my Samsung washer keep showing 5C?', a: 'The drain path is still restricted. Clean the debris filter AND the pump impeller behind it, and check the drain hose isn\'t kinked or clogged at the standpipe.' },
    ],
    related: [['samsung-washer-4c', 'Samsung Washer 4C'], ['washer-not-draining', 'Washer Not Draining'], ['frigidaire-dishwasher-i20', 'Frigidaire DW i20'] ] },

  { family: 'samsung', appliance: 'Washer', code: 'UB', brand: 'Samsung', display: 'UB', alt: 'UE / Ub',
    quick: "A Samsung UB (or UE) is an unbalanced-load message, not a breakdown — the washer stopped the spin because the load bunched to one side. It's a safety feature. Redistribute the load, make sure the machine is level, and it usually clears for free. Only if it happens every single load — even balanced ones — are the suspension rods or springs worn.",
    bench: "It's almost never a part. Open it, spread the load out evenly, and check the washer isn't rocking on an uneven floor.",
    parts: [
      { free: true, name: 'No part — rebalance & level it', note: 'Redistribute a bunched or single-heavy load (a rug, a comforter), and level the machine so it doesn\'t rock. Clears the vast majority of UB codes.' },
      { name: 'Suspension rod / spring kit', diff: 'moderate', price: '$30–80', terms: 'samsung washer suspension rod kit', note: 'Only if it\'s violently off-balance on EVERY load — worn rods let the tub swing. Replace as a set.' },
    ],
    safe: ['Open the lid/door, spread the load out evenly, and remove single heavy items to balance.', 'Make sure the washer is level and not rocking; adjust the feet.', 'Don\'t wash one big heavy item alone — add a couple towels to balance it.'],
    risk: ['Suspension rod replacement — moderate; unplug first and it takes a partial teardown.'],
    pro: ['A tub that bangs the cabinet hard even after re-leveling and a rod kit.'],
    worth: "Free most of the time — it\'s a load message, not a fault. A suspension kit ($30–80) only comes into play on an older machine that\'s off-balance every load.",
    faq: [
      { q: 'What does UB mean on a Samsung washer?', a: 'Unbalanced load — the washer halted the spin because the laundry bunched to one side (older displays show UE). Redistribute the load and make sure the machine is level.' },
      { q: 'How do I get my Samsung washer out of UB?', a: 'Open it, spread the load evenly, remove or balance any single heavy item, close it and restart the spin. Check the washer isn\'t rocking on an uneven floor.' },
      { q: 'Why does my Samsung washer keep saying UB?', a: 'If it happens on every load — even balanced ones — the suspension rods or springs are worn and let the tub swing. That\'s the one time it\'s a part.' },
    ],
    related: [['samsung-washer-dc', 'Samsung Washer DC'], ['washer-not-spinning', 'Washer Not Spinning'], ['lg-washer-ue', 'LG Washer UE'] ] },

  { family: 'samsung', appliance: 'Washer', code: 'DC', brand: 'Samsung', display: 'DC', alt: 'dE / dC',
    quick: "A Samsung DC (older: dE) means the washer can't confirm the door is shut and locked, so it won't run. First, just open and firmly re-close the door — check nothing (a stray sock) is caught in the seal. If it latches physically but still throws DC, the door lock assembly or its wiring is the fault.",
    bench: "Re-close it firmly first — and check the door strike and the boot fold for a piece of laundry blocking the latch.",
    parts: [
      { free: true, name: 'No part — re-close the door firmly', note: 'Make sure nothing is caught in the seal and the door clicks shut. A load pushing on the door can also fake a DC.' },
      { name: 'Door lock / latch assembly', diff: 'moderate', price: '$20–50', terms: 'samsung washer door lock assembly', note: 'If it latches physically but still shows DC, the lock switch has failed. Match your model.' },
    ],
    safe: ['Open and firmly re-close the door until it clicks.', 'Check the rubber boot fold and door strike for a trapped sock or debris.', 'Make sure the load isn\'t overstuffed and pushing the door open.'],
    risk: ['Door lock assembly swap — moderate; unplug first, remove the boot clamp or front panel to reach it.'],
    pro: ['A wiring/harness fault to the lock, or a control-board issue.'],
    worth: "Cheap either way — free if it\'s just re-closing, $20–50 for a door lock. Never a reason to replace the washer.",
    faq: [
      { q: 'What does DC mean on a Samsung washer?', a: 'The door didn\'t close/lock properly (older displays show dE). Re-close it firmly and check nothing is caught in the seal; if it still shows DC, the door lock assembly has failed.' },
      { q: 'How do I fix a Samsung DC code?', a: 'Open the door, clear anything in the seal or strike, and close it until it clicks. If the door physically latches but DC persists, replace the door lock/latch assembly.' },
    ],
    related: [['samsung-washer-ub', 'Samsung Washer UB'], ['whirlpool-washer-f5e2', 'Whirlpool Washer F5E2'], ['washer-not-spinning', 'Washer Not Spinning'] ] },

  { family: 'samsung', appliance: 'Refrigerator', code: '22C', brand: 'Samsung', display: '22C', alt: '22E',
    quick: "A Samsung 22C (older: 22E) is a fresh-food evaporator fan error — the fan that pushes cold air into the fridge section isn't spinning right. The usual cause is that the fan is iced up (a defrost problem) or the fan motor itself has failed, which is why the fridge goes warm while the freezer stays cold. Force a defrost first; if the fan's dead after it thaws, replace the fan motor.",
    bench: "A 22C often rides with an ice-buildup problem — thaw it out (unplug 24–48h or force-defrost) and see if the fan frees up before you buy the motor.",
    parts: [
      { free: true, name: 'No part — force defrost / thaw it out', note: 'Ice jamming the fan throws this code. Unplug 24–48 hours (cooler your food) or run the force-defrost sequence, then listen for the fan.' },
      { name: 'Evaporator fan motor', diff: 'moderate', price: '$30–80', terms: 'samsung refrigerator evaporator fan motor', note: 'If the fan\'s still dead or noisy after it thaws. Behind the fresh-food back panel. Match your model.' },
    ],
    safe: ['Listen at the fridge back panel for a dead or grinding fan.', 'Check for heavy frost — that points to a defrost problem jamming the fan.', 'Force-defrost or unplug 24–48h and see if the fan frees up.'],
    risk: ['Evaporator fan motor replacement — moderate; unplug, remove the interior back panel, let ice melt first.'],
    pro: ['A repeating defrost failure (heater/sensor/board) that keeps re-icing the fan.'],
    worth: "Worth it — a fan motor is $30–80 and a fridge that only needs a fan or a defrost clear is nowhere near replacement territory.",
    faq: [
      { q: 'What does 22C mean on a Samsung refrigerator?', a: 'A fresh-food evaporator fan error (older displays show 22E) — the fridge-section fan isn\'t running right, usually iced up or a failed fan motor. That\'s why the fridge warms while the freezer stays cold.' },
      { q: 'How do I fix a Samsung 22C code?', a: 'Force a defrost or unplug the fridge 24–48 hours to melt any ice jamming the fan. If the fan is still dead or noisy after it thaws, replace the evaporator fan motor behind the fresh-food back panel.' },
    ],
    related: [['samsung-refrigerator-of-of', 'Samsung Fridge OF OF'], ['refrigerator-not-cooling', 'Fridge Not Cooling'], ['lg-refrigerator-if', 'LG Fridge IF'] ] },

  { family: 'samsung', appliance: 'Refrigerator', code: 'OF OF', brand: 'Samsung', display: 'OF OF', alt: 'O FF / OFF',
    quick: "Good news: OF OF (or O FF) is NOT a breakdown — your Samsung fridge is in demo/cooling-off mode, the showroom setting that turns cooling off so a display unit doesn't run. It gets triggered by accident all the time. You fix it in 10 seconds by holding the right button combo, no part, no tech. This is the page to read BEFORE you spend a dime.",
    bench: "Don't let anyone sell you a repair for OF OF — it's a display mode. Hold the two buttons and it comes right back to life.",
    parts: [
      { free: true, name: 'No part — exit demo/cooling-off mode', note: 'On most models: press and hold the two top buttons (often Energy Saver + Fridge, or Power Freeze + Power Cool) together for ~8 seconds until it chimes and cooling restarts. Your model\'s manual lists the exact combo.' },
    ],
    safe: ['Press and hold the two indicated buttons (commonly Energy Saver + Fridge, or Power Cool + Power Freeze) for ~8 seconds until it chimes.', 'Check your model\'s manual for the exact demo-mode exit combo.', 'Give it a few hours to pull back down to temperature after exiting.'],
    risk: ['None — this is a settings fix, no tools.'],
    pro: ['If it truly won\'t exit demo mode after the correct combo, then a control-panel fault is possible — but that\'s rare.'],
    worth: "Free. Full stop. OF OF is the most over-charged-for \"repair\" in the trade because it looks scary and fixes in seconds.",
    faq: [
      { q: 'What does OF OF mean on a Samsung refrigerator?', a: 'It\'s demo mode (also shown as O FF) — a showroom setting that shuts cooling off so a display fridge doesn\'t run. It\'s not a malfunction and gets bumped on by accident often.' },
      { q: 'How do I turn off OF OF / demo mode on a Samsung fridge?', a: 'Press and hold the two indicated buttons together (commonly Energy Saver + Fridge, or Power Cool + Power Freeze) for about 8 seconds until it chimes and cooling restarts. Your model\'s manual lists the exact combo.' },
      { q: 'Is OF OF a serious problem?', a: 'No — it\'s a settings mode, not a fault. Don\'t pay for a repair. Exit demo mode with the button combo and let the fridge cool back down.' },
    ],
    related: [['samsung-refrigerator-22c', 'Samsung Fridge 22C'], ['refrigerator-not-cooling', 'Fridge Not Cooling'], ['refrigerator-not-making-ice', 'Ice Maker Not Working'] ] },

  { family: 'samsung', appliance: 'Dryer', code: 'HC', brand: 'Samsung', display: 'HC', alt: 'hE / HE',
    quick: "A Samsung HC (older: hE) is a heater / high-temperature error — the dryer's heat circuit is running too hot or reading a bad temperature. The silent root cause is almost always restricted airflow: a clogged lint screen or a blocked vent traps heat until the sensor faults. Clean the whole vent run first (free). If airflow's clear and it still faults, the thermistor or heating element is the part.",
    bench: "HC is an airflow code disguised as an electrical one — clean the lint screen AND the full vent to the outside flap before touching a part.",
    parts: [
      { free: true, name: 'No part — clear the lint screen & vent', note: 'A packed lint screen or blocked vent traps heat and trips HC. Clean the screen and the whole duct run to the exterior flap. The #1 free fix.' },
      { name: 'Thermistor (temp sensor)', diff: 'moderate', price: '$15–35', terms: 'samsung dryer thermistor', note: 'If airflow\'s clear but it still faults hot. A cheap sensor swap — test with a multimeter first.' },
      { name: 'Heating element', diff: 'moderate', price: '$40–90', terms: 'samsung dryer heating element', note: 'If it overheats/underheats and the thermistor checks out. Match your model.' },
    ],
    safe: ['Clean the lint screen every load, and clear the full vent duct to the outside flap.', 'Feel the exterior vent flap during a cycle — weak/no airflow means a blockage.', 'Give the dryer room to breathe; don\'t push it tight to the wall crushing the vent.'],
    risk: ['Thermistor or heating element replacement — moderate; UNPLUG the dryer (240V) and open the cabinet.'],
    pro: ['The 240V wiring/terminal block, or a control board not reading the sensor.'],
    worth: "Worth it — the free vent clean fixes many HC codes, and the thermistor/element are $15–90 versus $500+ for a new dryer.",
    faq: [
      { q: 'What does HC mean on a Samsung dryer?', a: 'A heater/high-temperature error (older displays show hE) — the heat circuit is running too hot or the temp sensor is out of range. Restricted airflow is the usual root cause; sometimes the thermistor or element.' },
      { q: 'How do I fix a Samsung HC code?', a: 'Clean the lint screen and the entire vent run to the outside first — that clears most HC codes. If airflow is clear and it still faults, test and replace the thermistor, then the heating element.' },
    ],
    related: [['whirlpool-dryer-f22', 'Whirlpool Dryer F22'], ['dryer-not-heating', 'Dryer Not Heating'], ['lg-dryer-d80-d90-d95', 'LG Dryer D80/D90/D95'] ] },

  // ── LG ─────────────────────────────────────────────────────────────────────
  { family: 'lg', appliance: 'Washer', code: 'OE', brand: 'LG', display: 'OE', alt: 'OE',
    quick: "An LG OE code means the washer couldn't drain the water in time. The top cause is the drain pump filter (a small door at the bottom-front) packed with lint and coins — a free clean that fixes most OE codes. If the filter's clear, check the drain hose for a kink or clog, then suspect the drain pump itself.",
    bench: "Open the bottom-front drain-pump filter first (towel down) — it's the fix on the majority of OE calls.",
    parts: [
      { free: true, name: 'No part — clean the drain pump filter', note: 'Bottom-front access door; twist the filter out (towel + pan, water spills) and clear lint, coins, and debris. Clears most OE codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$25–65', terms: 'lg washer drain pump', note: 'If the filter\'s clear but the pump hums without moving water, or is silent. Match your model.' },
    ],
    safe: ['Open and clean the drain-pump filter at the bottom-front (towel first).', 'Check the drain hose behind the machine for kinks and clogs at the standpipe.', 'Make sure the drain hose isn\'t pushed more than a few inches into the standpipe (siphoning).'],
    risk: ['Drain pump replacement — moderate; power off, water off, leftover water in the tub.'],
    pro: ['Water reaching the motor/control board.'],
    worth: "Very worth it — the filter clean is free and fixes most OE codes; a pump is $25–65 and about an hour.",
    faq: [
      { q: 'What does OE mean on an LG washer?', a: 'A drain error — the washer couldn\'t pump the water out in time. Usually a clogged drain-pump filter; sometimes a kinked drain hose or a failed drain pump.' },
      { q: 'How do I fix an LG OE code?', a: 'Open the bottom-front drain-pump filter and clean out lint and debris (towel down — water spills). Then check the drain hose for kinks. If it still won\'t drain, replace the drain pump.' },
    ],
    related: [['lg-washer-ie', 'LG Washer IE'], ['washer-not-draining', 'Washer Not Draining'], ['samsung-washer-5c', 'Samsung Washer 5C'] ] },

  { family: 'lg', appliance: 'Washer', code: 'IE', brand: 'LG', display: 'IE', alt: 'IE',
    quick: "An LG IE (inlet error) means the washer isn't filling with water fast enough. Like most fill faults, it's usually not a broken part — a closed faucet, a kinked or frozen hose, a clogged inlet screen, or low house water pressure. Rule those out free first; the water inlet valve is the part only when water's flowing and the screens are clear.",
    bench: "Both faucets full-on, then unscrew the hoses and rinse the mesh inlet screens — that's the free fix on most IE codes.",
    parts: [
      { free: true, name: 'No part — open valves & clear screens', note: 'Both hot and cold faucets fully open, hoses unkinked, and the mesh inlet screens rinsed clear. Handles most IE codes.' },
      { name: 'Water inlet valve', diff: 'moderate', price: '$25–55', terms: 'lg washer water inlet valve', note: 'Only if water\'s on and screens are clear but it still won\'t fill. Match your model.' },
    ],
    safe: ['Open both supply faucets fully.', 'Straighten the fill hoses; in winter check for freezing.', 'Rinse the mesh inlet screens where the hoses meet the washer.'],
    risk: ['Water inlet valve swap — moderate; power off, water off.'],
    pro: ['A wiring fault to the valve, or a pressure-sensor/board issue.'],
    worth: "Cheap — free checks clear most IE codes; the valve is $25–55. No reason to replace the machine.",
    faq: [
      { q: 'What does IE mean on an LG washer?', a: 'An inlet/water-supply error — the washer isn\'t filling fast enough. Usually a closed valve, kinked/frozen hose, clogged inlet screen, or low water pressure; sometimes the inlet valve.' },
      { q: 'How do I fix an LG IE code?', a: 'Open both faucets fully, straighten the hoses, and rinse the mesh inlet screens. If water is flowing and screens are clear but it still won\'t fill, replace the water inlet valve.' },
    ],
    related: [['lg-washer-oe', 'LG Washer OE'], ['samsung-washer-4c', 'Samsung Washer 4C'], ['washer-not-draining', 'Washer Not Draining'] ] },

  { family: 'lg', appliance: 'Washer', code: 'UE', brand: 'LG', display: 'UE', alt: 'uE',
    quick: "An LG UE is an unbalanced-load message — not a fault. The washer added water and re-tried to balance a load that bunched to one side, and finally gave up the spin. Redistribute the load, make sure the machine is level, and it clears for free. Only chronic UE on balanced loads points at worn suspension.",
    bench: "It's a load message, not a part. Spread the laundry out and confirm the washer isn't rocking on the floor.",
    parts: [
      { free: true, name: 'No part — rebalance & level it', note: 'Spread out a bunched or single-heavy load and level the machine. Clears nearly all UE codes.' },
      { name: 'Suspension rod / damper kit', diff: 'moderate', price: '$30–80', terms: 'lg washer suspension rod damper kit', note: 'Only if it\'s off-balance on every load — worn dampers let the tub swing. Replace as a set.' },
    ],
    safe: ['Open the door and spread the load out evenly; balance a single heavy item with a couple towels.', 'Level the washer so it doesn\'t rock.', 'Don\'t overload — leave room for the drum to tumble.'],
    risk: ['Suspension/damper replacement — moderate; unplug and partial teardown.'],
    pro: ['A tub that bangs hard even after leveling and new dampers.'],
    worth: "Free most of the time. A damper kit ($30–80) only for an older machine that\'s off-balance every load.",
    faq: [
      { q: 'What does UE mean on an LG washer?', a: 'Unbalanced load — the washer couldn\'t balance the load for the spin. Redistribute the laundry and make sure the machine is level; it\'s not a breakdown.' },
      { q: 'How do I clear an LG UE code?', a: 'Open the door, spread the load out evenly, balance any single heavy item, and restart the spin. Check the washer is level and not rocking.' },
    ],
    related: [['samsung-washer-ub', 'Samsung Washer UB'], ['lg-washer-le', 'LG Washer LE'], ['washer-not-spinning', 'Washer Not Spinning'] ] },

  { family: 'lg', appliance: 'Washer', code: 'LE', brand: 'LG', display: 'LE', alt: 'LE',
    quick: "An LG LE is a motor-locked / overload error — the drive motor stalled or drew too much current. On direct-drive LG washers it can be as simple as an overloaded or jammed drum (free to clear), but it's also the classic early warning of a failing rotor position sensor (a cheap part) or worn tub bearings (the expensive one). Test the cheap causes before you decide whether this machine is worth the big repair.",
    bench: "Clear an overload first, then suspect the rotor position sensor (Hall sensor) — it's a cheap common LE cause before you ever get to bearings.",
    parts: [
      { free: true, name: 'No part — clear an overload/jam', note: 'Remove a too-heavy load and spin the drum by hand with power off — it should turn freely. A jam or overload throws LE.' },
      { name: 'Rotor position (Hall) sensor', diff: 'moderate', price: '$15–40', terms: 'lg washer rotor position sensor hall sensor', note: 'A common, cheap LE cause on direct-drive LG washers. Test/replace before assuming bearings.' },
      { name: 'Tub bearing kit', diff: 'pro', price: '$40–120', terms: 'lg washer tub bearing kit', note: 'If the drum is loud/rough and has play — a big teardown. On an older machine, weigh against replacing.' },
    ],
    safe: ['Remove an overloaded load and restart.', 'With power off, spin the drum by hand — it should turn freely with no grinding.', 'Listen on spin for a loud roar/grind (points to bearings).'],
    risk: ['Rotor position sensor swap — moderate; unplug, remove the rear rotor to reach it.'],
    pro: ['Tub bearings (major teardown) or the drive motor.'],
    worth: "Depends where it lands. A jam is free and the rotor sensor is $15–40 — clearly worth it. Worn tub bearings are a big-labor job; on an older LG that\'s the one where replacing can win. Test the cheap causes first.",
    faq: [
      { q: 'What does LE mean on an LG washer?', a: 'A motor-locked / overload error — the drive motor stalled or over-drew current. Often just an overload; also a common failing rotor position sensor, or worn tub bearings on higher-mileage machines.' },
      { q: 'Is an LG LE code expensive to fix?', a: 'Not always. Clear an overload (free) and check the rotor position sensor ($15–40) first. Only worn tub bearings are a costly repair worth weighing against a new machine.' },
    ],
    related: [['lg-washer-ue', 'LG Washer UE'], ['washer-not-spinning', 'Washer Not Spinning'], ['lg-washer-oe', 'LG Washer OE'] ] },

  { family: 'lg', appliance: 'Dryer', code: 'D80', brand: 'LG', display: 'D80 / D90 / D95', alt: 'Flow Sense',
    quick: "LG's D80, D90, and D95 aren't faults — they're LG's Flow Sense telling you the exhaust duct is 80%, 90%, or 95% blocked. It's a warning, and it's costing you dry time and risking a fire. The fix is free-to-cheap: clean the lint screen and the entire vent run to the outside flap. A vent-cleaning kit makes it easy. D95 means clean it NOW.",
    bench: "These are the most useful \"codes\" LG makes — they're literally telling you how blocked your vent is. D95 = go clean it before it becomes a fire.",
    parts: [
      { free: true, name: 'No part — clean the lint screen & duct', note: 'Clean the lint screen, then disconnect and clear the whole vent duct to the exterior flap. Free, and it\'s the actual fix.' },
      { name: 'Dryer vent cleaning kit', diff: 'easy', price: '$15–35', terms: 'dryer vent cleaning kit brush rods', note: 'A rod-and-brush kit reaches the full wall duct a hand can\'t. The single best tool for D80/D90/D95.' },
      { name: 'Dryer vent hose (if crushed)', diff: 'easy', price: '$10–25', terms: 'dryer vent hose semi rigid', note: 'Replace only if the transition hose behind the dryer is crushed or torn — semi-rigid lasts longer than foil.' },
    ],
    safe: ['Clean the lint screen every load.', 'Disconnect the vent behind the dryer and clear the whole run to the outside flap with a brush kit.', 'Check the exterior flap opens freely and isn\'t blocked by a bird nest or lint mat.'],
    risk: ['Reconnecting/replacing a crushed transition hose — easy; unplug and pull the dryer out.'],
    pro: ['A long/complex roof vent run you can\'t safely reach.'],
    worth: "Free-to-cheap and non-negotiable — a blocked vent is the #1 dryer-fire cause. A $15–35 vent kit pays for itself in dry time and safety.",
    faq: [
      { q: 'What does D80, D90, or D95 mean on an LG dryer?', a: 'LG\'s Flow Sense warning that the exhaust vent is roughly 80%, 90%, or 95% restricted. It\'s not a breakdown — it\'s telling you to clean the vent. D95 means clean it right away.' },
      { q: 'How do I clear an LG D80/D90/D95 code?', a: 'Clean the lint screen, then disconnect the vent behind the dryer and clear the entire duct to the outside flap with a vent-cleaning brush kit. Check the exterior flap isn\'t blocked.' },
      { q: 'Is a D95 code dangerous?', a: 'It should be taken seriously — a 95%-blocked vent traps heat and lint, the leading cause of dryer fires. Clean the full vent run before running the dryer again.' },
    ],
    related: [['samsung-dryer-hc', 'Samsung Dryer HC'], ['dryer-not-heating', 'Dryer Not Heating'], ['whirlpool-dryer-af', 'Whirlpool Dryer AF'] ] },

  { family: 'lg', appliance: 'Refrigerator', code: 'IF', brand: 'LG', display: 'IF', alt: 'Er IF',
    quick: "An LG IF (or Er IF) is an ice-maker fan fault — the small fan that keeps the ice compartment cold isn't running normally, usually because it's iced over or the fan motor failed. Ice production drops or stops. Force a defrost / thaw it out first; if the fan is still dead after it clears, replace the ice-maker fan.",
    bench: "IF usually rides with frost — thaw the ice-maker area and see if the fan frees up before ordering the motor.",
    parts: [
      { free: true, name: 'No part — thaw the iced fan', note: 'Frost jamming the ice-room fan throws IF. Force-defrost or unplug 24 hours (cooler your food) and listen for the fan to free up.' },
      { name: 'Ice maker / ice-room fan motor', diff: 'moderate', price: '$30–75', terms: 'lg refrigerator ice maker fan motor', note: 'If the fan\'s still dead after thawing. Match your model.' },
    ],
    safe: ['Listen for a dead or grinding fan near the ice maker.', 'Check for frost buildup jamming the fan.', 'Force-defrost or unplug 24h and see if the fan frees.'],
    risk: ['Ice-room fan motor replacement — moderate; unplug, remove a panel, melt ice first.'],
    pro: ['A repeating defrost failure that keeps re-icing the fan.'],
    worth: "Worth it — a fan is $30–75 and never a reason to replace an otherwise-good fridge.",
    faq: [
      { q: 'What does IF mean on an LG refrigerator?', a: 'An ice-maker fan fault (also shown Er IF) — the ice-compartment fan isn\'t running right, usually iced over or a failed fan motor, so ice production drops.' },
      { q: 'How do I fix an LG IF code?', a: 'Force a defrost or unplug the fridge ~24 hours to melt frost jamming the fan. If the fan is still dead after it thaws, replace the ice-maker fan motor.' },
    ],
    related: [['samsung-refrigerator-22c', 'Samsung Fridge 22C'], ['refrigerator-not-making-ice', 'Ice Maker Not Working'], ['refrigerator-not-cooling', 'Fridge Not Cooling'] ] },

  // ── Whirlpool / Maytag ──────────────────────────────────────────────────────
  { family: 'whirlpool', appliance: 'Washer', code: 'F5E2', brand: 'Whirlpool', display: 'F5E2', alt: 'F5 E2',
    quick: "A Whirlpool F5E2 means the lid lock won't lock, so the washer won't start the cycle. First check the obvious — something under the lid, or the lid not seating. If it seats fine but won't lock, the lid-lock/latch assembly (a common wear part on these top-loaders) or its wiring is the cause. It's a cheap, well-documented fix.",
    bench: "F5E2 is almost always the lid-lock assembly itself — it's a known wear part on Whirlpool top-loaders. Check the connector, then replace the lock.",
    parts: [
      { free: true, name: 'No part — clear the lid & reseat', note: 'Make sure nothing blocks the lid and it sits flush. Unplug 1 minute to reset the lock, then retry.' },
      { name: 'Lid lock / latch assembly', diff: 'moderate', price: '$25–60', terms: 'whirlpool washer lid lock latch assembly', note: 'The common F5E2 fix — the lock striker/switch wears out. Match your model number.' },
    ],
    safe: ['Clear anything under the lid and make sure it seats flat.', 'Unplug the washer for a minute to reset the lock, then retry.', 'Watch/listen — does the lock try to engage and fail, or do nothing?'],
    risk: ['Lid lock assembly replacement — moderate; unplug first, remove the top panel to reach the lock.'],
    pro: ['A wiring/harness fault to the lock, or a main-control (CCU) issue.'],
    worth: "Worth it — the lid lock is $25–60 and about 30–45 minutes versus a new washer. A classic, cheap Whirlpool fix.",
    faq: [
      { q: 'What does F5E2 mean on a Whirlpool washer?', a: 'The lid lock won\'t lock, so the cycle won\'t start. Usually the lid-lock/latch assembly has worn out; sometimes just something blocking the lid.' },
      { q: 'How do I fix a Whirlpool F5E2 code?', a: 'Clear anything under the lid and reset the washer (unplug 1 minute). If it still won\'t lock, replace the lid-lock/latch assembly — a common, inexpensive part.' },
    ],
    related: [['whirlpool-washer-ld', 'Whirlpool Washer LD'], ['samsung-washer-dc', 'Samsung Washer DC'], ['washer-not-spinning', 'Washer Not Spinning'] ] },

  { family: 'whirlpool', appliance: 'Washer', code: 'LD', brand: 'Whirlpool', display: 'LD', alt: 'Ld',
    quick: "A Whirlpool LD means \"long drain\" — the water isn't leaving fast enough. It's a drain-path problem, not a dead machine. Clean the drain pump filter, check the drain hose for a kink or a too-deep push into the standpipe, then suspect the drain pump. Most LD codes clear with a free filter/hose clean.",
    bench: "LD is a drain-speed code — clear the pump filter and make sure the drain hose isn't shoved 12 inches down the standpipe (it siphons and re-triggers).",
    parts: [
      { free: true, name: 'No part — clean filter & check hose', note: 'Clean the drain-pump filter/coin trap and make sure the drain hose isn\'t kinked or pushed more than a few inches into the standpipe.' },
      { name: 'Drain pump', diff: 'moderate', price: '$25–70', terms: 'whirlpool washer drain pump', note: 'If the filter and hose are clear but the pump hums or is silent on drain. Match your model.' },
    ],
    safe: ['Clean the drain-pump filter/coin trap (towel down).', 'Check the drain hose for kinks and how far it goes into the standpipe.', 'Run a drain/spin-only cycle to confirm.'],
    risk: ['Drain pump replacement — moderate; power off, water off.'],
    pro: ['Water reaching the motor/control board.'],
    worth: "Very worth it — free to clean, $25–70 for a pump. Draining fixes are the cheapest washer repairs there are.",
    faq: [
      { q: 'What does LD mean on a Whirlpool washer?', a: 'Long drain — the washer isn\'t draining fast enough. Usually a clogged pump filter or a kinked/siphoning drain hose; sometimes a failed drain pump.' },
      { q: 'How do I fix a Whirlpool LD code?', a: 'Clean the drain-pump filter and check the drain hose for kinks and how deep it sits in the standpipe. If those are clear and it still drains slowly, replace the drain pump.' },
    ],
    related: [['whirlpool-washer-f5e2', 'Whirlpool Washer F5E2'], ['washer-not-draining', 'Washer Not Draining'], ['lg-washer-oe', 'LG Washer OE'] ] },

  { family: 'whirlpool', appliance: 'Dryer', code: 'F22', brand: 'Whirlpool', display: 'F22', alt: 'F-22',
    quick: "A Whirlpool F22 is an exhaust thermistor (temperature sensor) fault — the sensor that watches the outlet temp is reading out of range. It's usually a cheap sensor swap, but restricted airflow can drive false high-temp readings, so clean the vent first. Test the thermistor with a multimeter; it's a low-cost, common fix.",
    bench: "Clean the vent, then ohm-out the thermistor — F22 is a cheap sensor 9 times out of 10, not a control board.",
    parts: [
      { free: true, name: 'No part — clear the lint screen & vent', note: 'Restricted airflow skews the temp reading. Clean the lint screen and the full vent run first.' },
      { name: 'Exhaust thermistor (temp sensor)', diff: 'moderate', price: '$12–30', terms: 'whirlpool dryer exhaust thermistor', note: 'The common F22 fix. Test for the correct resistance with a multimeter, then swap. Match your model.' },
    ],
    safe: ['Clean the lint screen and the whole vent to the outside.', 'Feel the exterior flap for weak airflow (a blockage skews the sensor).', 'If you have a multimeter, check the thermistor resistance against spec.'],
    risk: ['Thermistor replacement — moderate; UNPLUG the dryer (240V) and open the cabinet to reach it.'],
    pro: ['The 240V wiring, or a control board not reading the sensor.'],
    worth: "Worth it — the thermistor is $12–30 and quick; a new dryer is $500+. One of the cheaper dryer fixes.",
    faq: [
      { q: 'What does F22 mean on a Whirlpool dryer?', a: 'An exhaust thermistor (temperature sensor) fault — the outlet-temp sensor is reading out of range. Usually a cheap sensor swap; restricted airflow can trigger it too.' },
      { q: 'How do I fix a Whirlpool F22 code?', a: 'Clean the vent first (airflow skews the reading). Then test the exhaust thermistor with a multimeter and replace it if it\'s out of spec — an inexpensive, common fix.' },
    ],
    related: [['whirlpool-dryer-af', 'Whirlpool Dryer AF'], ['samsung-dryer-hc', 'Samsung Dryer HC'], ['dryer-not-heating', 'Dryer Not Heating'] ] },

  { family: 'whirlpool', appliance: 'Dryer', code: 'AF', brand: 'Whirlpool', display: 'AF', alt: 'A-F',
    quick: "A Whirlpool AF means restricted airflow — the dryer detected its exhaust can't breathe. It's not a broken part; it's a warning that a clogged lint screen or blocked vent is choking the dryer (and risking a fire). Clean the screen and the whole vent run to the outside. A vent-cleaning kit makes short work of it.",
    bench: "AF is the dryer telling you to clean the vent. Do it — a blocked vent is the top dryer-fire cause.",
    parts: [
      { free: true, name: 'No part — clean the lint screen & vent', note: 'Clean the lint screen and clear the entire duct to the exterior flap. Free, and it\'s the actual fix.' },
      { name: 'Dryer vent cleaning kit', diff: 'easy', price: '$15–35', terms: 'dryer vent cleaning kit brush rods', note: 'A rod-and-brush kit reaches the wall duct a hand can\'t. The right tool for AF.' },
    ],
    safe: ['Clean the lint screen every load.', 'Clear the full vent duct to the outside flap with a brush kit.', 'Confirm the exterior flap opens and isn\'t matted with lint or a bird nest.'],
    risk: ['Replacing a crushed transition hose — easy; unplug and pull the dryer out.'],
    pro: ['A long/complex roof vent you can\'t safely reach.'],
    worth: "Free-to-cheap and important — a clean vent dries faster and prevents fires. A $15–35 kit is the whole cost.",
    faq: [
      { q: 'What does AF mean on a Whirlpool dryer?', a: 'Restricted airflow — the dryer sensed its exhaust is blocked. It\'s a warning, not a broken part. Clean the lint screen and the full vent run to the outside.' },
      { q: 'How do I clear a Whirlpool AF code?', a: 'Clean the lint screen and clear the entire vent duct to the exterior flap (a vent brush kit helps). Make sure the outside flap opens freely.' },
    ],
    related: [['lg-dryer-d80-d90-d95', 'LG Dryer D80/D90/D95'], ['whirlpool-dryer-f22', 'Whirlpool Dryer F22'], ['dryer-not-heating', 'Dryer Not Heating'] ] },

  { family: 'whirlpool', appliance: 'Range', code: 'F3E1', brand: 'Whirlpool', display: 'F3E1', alt: 'F3 E1',
    quick: "A Whirlpool F3E1 is an oven temperature sensor (RTD) fault — the probe that tells the oven how hot it is has gone open or shorted, so the oven can't regulate and shuts the bake circuit down. It's a cheap, beginner-friendly part: the sensor unclips inside the oven and unplugs behind the back panel. Test its resistance to confirm before you buy.",
    bench: "F3E1 is the temp sensor, not the board — a cold oven sensor should read about 1080–1090 ohms. Ohm it out, then swap it.",
    parts: [
      { name: 'Oven temperature sensor (RTD)', diff: 'moderate', price: '$15–40', terms: 'whirlpool oven temperature sensor rtd', note: 'The F3E1 fix. Unclips inside the oven, unplugs behind the rear panel. A cold sensor reads ~1080Ω — test before buying. Match your model.' },
      { name: 'Oven control board', diff: 'pro', price: '$80–250', terms: 'whirlpool oven control board', note: 'Rare — only if a known-good sensor still throws F3E1. Confirm before buying.' },
    ],
    safe: ['Let the oven cool, then check the sensor probe isn\'t touching the oven wall.', 'With power off, ohm the sensor — a cold RTD reads roughly 1080–1090 ohms; open/short confirms it.', 'Check the sensor\'s plug behind the back panel is seated.'],
    risk: ['Temperature sensor replacement — moderate; cut power at the breaker (240V), unclip and unplug the sensor.'],
    pro: ['The 240V wiring, or an oven control board diagnosis you\'re unsure of.'],
    worth: "Worth it — the sensor is $15–40 and 20 minutes versus $700+ for a new range. Only a rare control-board case tips otherwise.",
    faq: [
      { q: 'What does F3E1 mean on a Whirlpool oven?', a: 'The oven temperature sensor (RTD) is open or shorted, so the oven can\'t regulate temperature and stops heating. It\'s usually a cheap sensor replacement.' },
      { q: 'How do I fix a Whirlpool F3E1 code?', a: 'With power off, ohm-test the oven temp sensor (a cold RTD reads ~1080 ohms). If it\'s open, shorted, or out of spec, replace the sensor — it unclips inside the oven and unplugs behind the back panel.' },
    ],
    related: [['ge-range-f3', 'GE Range F3'], ['oven-not-heating', 'Oven Not Heating'], ['frigidaire-dryer-e64', 'Frigidaire Dryer E64'] ] },

  // ── Frigidaire / Electrolux ─────────────────────────────────────────────────
  { family: 'frigidaire', appliance: 'Dryer', code: 'E64', brand: 'Frigidaire', display: 'E64', alt: 'E-64',
    quick: "A Frigidaire E64 means the heating element circuit is open — the dryer isn't heating because the element (or its wiring) has burned through. It's the classic no-heat fix on these dryers and a straightforward part swap. As always, clear the vent too: restricted airflow overheats and kills elements early.",
    bench: "E64 is a burned-open heating element most of the time — test it for continuity, then replace, and clean the vent so the new one lasts.",
    parts: [
      { name: 'Heating element', diff: 'moderate', price: '$30–70', terms: 'frigidaire dryer heating element', note: 'The E64 fix. Test for continuity with a multimeter — an open element confirms it. Match your model.' },
      { free: true, name: 'Also clear the vent', note: 'A blocked vent overheats and shortens element life. Clean the lint screen and full duct when you replace the element.' },
    ],
    safe: ['UNPLUG the dryer (240V) before anything.', 'With a multimeter, test the heating element for continuity — no continuity = open element.', 'Clean the vent run so the replacement element doesn\'t cook itself.'],
    risk: ['Heating element replacement — moderate; unplug, open the cabinet, swap the element assembly.'],
    pro: ['The 240V wiring/terminal block, or a control board fault.'],
    worth: "Worth it — the element is $30–70 and an hour versus $500+ new. A standard, cost-effective dryer repair.",
    faq: [
      { q: 'What does E64 mean on a Frigidaire dryer?', a: 'The heating element circuit is open — the element (or its wiring) has burned through, so the dryer runs but won\'t heat. It\'s usually a straightforward element replacement.' },
      { q: 'How do I fix a Frigidaire E64 code?', a: 'Unplug the dryer, test the heating element for continuity with a multimeter, and replace it if it reads open. Clean the vent run too so the new element doesn\'t overheat.' },
    ],
    related: [['dryer-not-heating', 'Dryer Not Heating'], ['whirlpool-dryer-f22', 'Whirlpool Dryer F22'], ['frigidaire-washer-e20', 'Frigidaire Washer E20'] ] },

  { family: 'frigidaire', appliance: 'Washer', code: 'E20', brand: 'Frigidaire', display: 'E20', alt: 'E-20',
    quick: "A Frigidaire E20 (front-loader) means the washer won't drain. The top cause is a clogged drain-pump filter packed with lint and coins — a free clean that fixes most E20 codes. If the filter's clear, check the drain hose, then the drain pump. Standard drain-path troubleshooting.",
    bench: "Open the bottom-front drain filter first (towel down) — most E20 codes are lint and coins, not a bad pump.",
    parts: [
      { free: true, name: 'No part — clean the drain filter', note: 'Bottom-front access door; twist the filter out (towel + pan) and clear lint, coins, and debris. Clears most E20 codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–70', terms: 'frigidaire washer drain pump', note: 'If the filter\'s clear but the pump hums or is silent on drain. Match your model.' },
    ],
    safe: ['Clean the bottom-front drain-pump filter (towel first).', 'Check the drain hose for kinks and clogs at the standpipe.', 'Run a drain/spin-only cycle to confirm.'],
    risk: ['Drain pump replacement — moderate; power off, water off.'],
    pro: ['Water reaching the motor/control board.'],
    worth: "Very worth it — free to clean, $30–70 for a pump. Among the cheapest washer repairs.",
    faq: [
      { q: 'What does E20 mean on a Frigidaire washer?', a: 'A drain fault — the washer didn\'t drain in time. Usually a clogged drain-pump filter; sometimes a kinked hose or a failed drain pump.' },
      { q: 'How do I fix a Frigidaire E20 code?', a: 'Open and clean the bottom-front drain-pump filter (water spills — towel down). Check the drain hose for kinks. If it still won\'t drain, replace the drain pump.' },
    ],
    related: [['frigidaire-dishwasher-i20', 'Frigidaire DW i20'], ['washer-not-draining', 'Washer Not Draining'], ['samsung-washer-5c', 'Samsung Washer 5C'] ] },

  { family: 'frigidaire', appliance: 'Dishwasher', code: 'I20', brand: 'Frigidaire', display: 'i20', alt: 'I20',
    quick: "A Frigidaire i20 means the dishwasher isn't draining — a drain fault. Start with the free stuff: the filter/sump packed with food, the drain hose kinked under the sink, or (if a disposal was just installed) the knockout plug left in. If those are clear, the drain pump is the part.",
    bench: "If a garbage disposal was recently put in, check the knockout plug FIRST — a left-in plug makes an i20 that no part will fix.",
    parts: [
      { free: true, name: 'No part — clear filter, hose & knockout plug', note: 'Clean the filter/sump, straighten the drain hose, and if a disposal was just installed, confirm the knockout plug was punched out. These clear most i20 codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–80', terms: 'frigidaire dishwasher drain pump', note: 'If everything upstream is clear and it still won\'t drain. Buy for your exact model.' },
    ],
    safe: ['Remove the bottom rack, clean the filter/sump of food and debris.', 'Check the drain hose under the sink for kinks and clogs.', 'If a disposal was just installed, confirm the knockout plug was removed.'],
    risk: ['Drain pump replacement — moderate; cut power at the breaker and shut the water off.'],
    pro: ['A leak reaching the wiring/control under the tub.'],
    worth: "Usually worth it — the top causes are free and the drain pump is $30–80 versus $500+ for a new dishwasher plus install.",
    faq: [
      { q: 'What does i20 mean on a Frigidaire dishwasher?', a: 'A drain fault — the dishwasher didn\'t drain. Usually a clogged filter/sump, a kinked drain hose, or a disposal knockout plug left in; sometimes a failed drain pump.' },
      { q: 'How do I fix a Frigidaire i20 code?', a: 'Clean the filter and sump, straighten the drain hose, and check for a left-in disposal knockout plug. If those are clear, replace the drain pump.' },
    ],
    related: [['bosch-dishwasher-e24', 'Bosch DW E24'], ['dishwasher-not-draining', 'Dishwasher Not Draining'], ['ge-dishwasher-c4', 'GE DW C4'] ] },

  // ── Bosch ────────────────────────────────────────────────────────────────────
  { family: 'bosch', appliance: 'Dishwasher', code: 'E15', brand: 'Bosch', display: 'E15', alt: 'E-15',
    quick: "A Bosch E15 means water collected in the base pan and tripped the Aquastop anti-flood float — the dishwasher shuts off the water to protect your floor. Often it's a small spill or condensation, not a real leak. The free fix: tilt the unit to drain the pan and dry the float so it drops. If it comes right back, you've got an actual leak to find (a hose, seal, or the pump).",
    bench: "E15 is a float trip, not a part by itself. Tip the dishwasher back to drain the base pan, dry the float, and it usually resets — then watch whether it returns.",
    parts: [
      { free: true, name: 'No part — drain the base pan & dry the float', note: 'Tilt the dishwasher back ~45° to drain water from the base, or soak it out with a towel so the foam float drops. Clears the E15 in most cases.' },
      { name: 'Find & fix the leak source', diff: 'moderate', price: '$15–70', terms: 'bosch dishwasher door seal drain hose', note: 'If E15 returns fast, water is still getting into the base — check the door seal, hose clamps, and the drain hose/sump for the leak, then replace the failed part.' },
    ],
    safe: ['Turn off the dishwasher and tilt it back to drain the base pan (towel underneath).', 'Dry the base so the foam anti-flood float drops.', 'Restart — if E15 clears and stays gone, it was a one-time spill.'],
    risk: ['Tracing and replacing a leaking seal/hose — moderate; power and water off, some disassembly.'],
    pro: ['A leak you can\'t locate, or water reaching the wiring/control.'],
    worth: "Often free — an E15 is frequently just a drained-pan reset. Only a real, recurring leak means a part ($15–70), still far under a new machine.",
    faq: [
      { q: 'What does E15 mean on a Bosch dishwasher?', a: 'The anti-flood (Aquastop) float in the base pan detected water and shut the dishwasher off to prevent a leak. Often just a small spill or condensation — draining and drying the base pan usually clears it.' },
      { q: 'How do I fix a Bosch E15 error?', a: 'Turn it off, tilt the unit back to drain the base pan, and dry it so the foam float drops, then restart. If E15 comes right back, water is still entering the base — find and fix the leaking seal, hose, or sump.' },
    ],
    related: [['bosch-dishwasher-e24', 'Bosch DW E24'], ['ge-dishwasher-c4', 'GE DW C4'], ['dishwasher-not-draining', 'Dishwasher Not Draining'] ] },

  { family: 'bosch', appliance: 'Dishwasher', code: 'E24', brand: 'Bosch', display: 'E24', alt: 'E-24',
    quick: "A Bosch E24 means the dishwasher isn't draining — a drainage fault. Start free: clean the filter and pump area, and check the drain hose for a kink or a clog at the high loop / disposal connection. If the path is clear and it still won't drain, the drain pump is blocked or failed.",
    bench: "Pull the filter and check the pump impeller for glass or a toothpick jammed in it — a stuck impeller is a common E24 that costs nothing to clear.",
    parts: [
      { free: true, name: 'No part — clean filter, pump & hose', note: 'Remove and rinse the filter, clear the pump impeller of debris/glass, and check the drain hose for kinks and the disposal knockout plug. Clears many E24 codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–80', terms: 'bosch dishwasher drain pump', note: 'If the filter, impeller, and hose are clear but it still won\'t drain. Match your model.' },
    ],
    safe: ['Remove and rinse the filter; check the pump impeller for lodged debris/glass.', 'Check the drain hose for kinks and clogs at the high loop and disposal.', 'Confirm a newly-installed disposal\'s knockout plug was removed.'],
    risk: ['Drain pump replacement — moderate; power and water off.'],
    pro: ['A leak reaching the wiring, or a control fault.'],
    worth: "Usually worth it — the free checks fix many E24 codes; a drain pump is $30–80 versus $500+ for a new Bosch.",
    faq: [
      { q: 'What does E24 mean on a Bosch dishwasher?', a: 'A drainage fault — the dishwasher isn\'t draining. Usually a clogged filter, debris jamming the pump impeller, or a kinked drain hose; sometimes a failed drain pump.' },
      { q: 'How do I fix a Bosch E24 code?', a: 'Clean the filter and clear the pump impeller of debris, then check the drain hose for kinks and the disposal knockout plug. If it still won\'t drain, replace the drain pump.' },
    ],
    related: [['bosch-dishwasher-e15', 'Bosch DW E15'], ['frigidaire-dishwasher-i20', 'Frigidaire DW i20'], ['dishwasher-not-draining', 'Dishwasher Not Draining'] ] },

  // ── GE ───────────────────────────────────────────────────────────────────────
  { family: 'ge', appliance: 'Range', code: 'F3', brand: 'GE', display: 'F3', alt: 'F-3',
    quick: "A GE F3 is an oven temperature sensor (RTD) fault — the sensor reads open, so the oven can't regulate temperature. It's a cheap, common fix: the sensor unclips inside the oven and unplugs behind the back panel. Ohm-test it to confirm before buying — a cold RTD reads around 1080 ohms.",
    bench: "F3 is the temp sensor open-circuit — check the plug behind the oven is seated, ohm the sensor, then swap it. Rarely the board.",
    parts: [
      { name: 'Oven temperature sensor (RTD)', diff: 'moderate', price: '$15–40', terms: 'ge oven temperature sensor rtd', note: 'The F3 fix. A cold sensor reads ~1080Ω; open/out-of-spec confirms it. Unclips inside the oven. Match your model.' },
      { name: 'Oven control board', diff: 'pro', price: '$90–250', terms: 'ge oven control board', note: 'Rare — only if a known-good sensor still throws F3. Confirm before buying.' },
    ],
    safe: ['Let the oven cool; check the sensor probe isn\'t touching the oven wall.', 'With power off, ohm-test the sensor (a cold RTD reads ~1080 ohms).', 'Check the sensor plug behind the rear panel is seated.'],
    risk: ['Temperature sensor replacement — moderate; cut power at the breaker (240V), unclip and unplug the sensor.'],
    pro: ['The 240V wiring, or an oven control board you\'re unsure of.'],
    worth: "Worth it — the sensor is $15–40 and 20 minutes versus $700+ for a new range.",
    faq: [
      { q: 'What does F3 mean on a GE oven or range?', a: 'The oven temperature sensor (RTD) reads open, so the oven can\'t control temperature. It\'s usually a cheap sensor replacement (some models use F3/F4 for open vs shorted).' },
      { q: 'How do I fix a GE F3 code?', a: 'With power off, ohm-test the oven temp sensor — a cold RTD reads about 1080 ohms. If it\'s open or out of spec, replace the sensor; it unclips inside the oven and unplugs behind the back panel.' },
    ],
    related: [['whirlpool-range-f3e1', 'Whirlpool Oven F3E1'], ['oven-not-heating', 'Oven Not Heating'], ['ge-dishwasher-c4', 'GE DW C4'] ] },

  { family: 'ge', appliance: 'Dishwasher', code: 'C4', brand: 'GE', display: 'C4', alt: 'C-4',
    quick: "A GE C4 means the dishwasher's flood float tripped — it sensed an overfill or a leak and cut off to protect your floor. Often it's just too much water sitting from a slow drain, or a stuck float. Check the free stuff: clear the filter/drain so water isn't pooling, and make sure the float moves freely. If water keeps collecting, the water inlet valve may be leaking through.",
    bench: "C4 is a flood-float trip — clear the drain so water isn't sitting, and make sure the float isn't stuck up before you suspect the valve.",
    parts: [
      { free: true, name: 'No part — clear the drain & free the float', note: 'Clean the filter/sump so water drains, and check the flood float moves up and down freely (not stuck by debris). Clears many C4 codes.' },
      { name: 'Water inlet valve', diff: 'moderate', price: '$20–55', terms: 'ge dishwasher water inlet valve', note: 'If water keeps collecting even when the drain is clear, the inlet valve is leaking through. Shut the water off first.' },
    ],
    safe: ['Clean the filter/sump so water isn\'t pooling and re-tripping the float.', 'Check the flood float moves freely and isn\'t jammed by debris.', 'Watch whether water keeps filling with the door shut (points to the valve).'],
    risk: ['Water inlet valve replacement — moderate; power and water off.'],
    pro: ['A leak reaching the wiring, or a control fault.'],
    worth: "Usually cheap — free if it\'s a stuck float or a drain clear, $20–55 if the inlet valve is leaking through.",
    faq: [
      { q: 'What does C4 mean on a GE dishwasher?', a: 'The flood float tripped — the dishwasher sensed an overfill or leak and shut off to protect your floor. Often just water pooling from a slow drain or a stuck float; sometimes a leaking inlet valve.' },
      { q: 'How do I fix a GE C4 code?', a: 'Clean the filter and sump so water drains properly, and make sure the flood float moves freely. If water keeps collecting even when the drain is clear, replace the water inlet valve.' },
    ],
    related: [['bosch-dishwasher-e15', 'Bosch DW E15'], ['frigidaire-dishwasher-i20', 'Frigidaire DW i20'], ['dishwasher-not-draining', 'Dishwasher Not Draining'] ] },
];

// ---- build the derived fields ----------------------------------------------
function slugFor(c) {
  const appl = c.appliance.toLowerCase();
  const code = c.display.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${c.family}-${appl}-${code}`;
}

function enrich(c) {
  const src = corpus(c.family, c.appliance, c.code);
  const slug = slugFor(c);
  const icon = ICON[c.appliance] || '🔧';
  const applName = c.appliance === 'Range' ? 'Oven / Range' : c.appliance;
  const title = `${c.brand} ${applName} ${c.display} — What It Means & How to Fix It`;
  const desc = `${c.brand} ${c.appliance.toLowerCase()} showing ${c.display}? ${src.meaning}. The real cause, the 2-minute test, and the exact part — plus when to just call a pro.`;
  const kw = [
    `${c.brand.toLowerCase()} ${c.appliance.toLowerCase()} ${c.display.toLowerCase()}`,
    `${c.brand.toLowerCase()} ${c.display.toLowerCase()} error`,
    `${c.brand.toLowerCase()} ${c.display.toLowerCase()} code`,
    c.alt ? `${c.brand.toLowerCase()} ${c.alt.toLowerCase()}` : '',
    `${c.brand.toLowerCase()} ${c.appliance.toLowerCase()} ${src.meaning.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 4).join(' ')}`,
    `how to fix ${c.brand.toLowerCase()} ${c.display.toLowerCase()}`,
  ].filter(Boolean).join(', ');
  return { ...c, slug, icon, applName, title, desc, keywords: kw, meaning: src.meaning, likely: src.likely_causes, test: src.test };
}

// ---- schema builders -------------------------------------------------------
function faqSchema(c) {
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: c.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
}
function breadcrumbSchema(c) {
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://applianceant.com/' },
    { '@type': 'ListItem', position: 2, name: 'Fault Codes', item: 'https://applianceant.com/fault-codes' },
    { '@type': 'ListItem', position: 3, name: `${c.brand} ${c.applName} ${c.display}`, item: `https://applianceant.com/${c.slug}` },
  ] });
}
function howToSchema(c) {
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'HowTo', name: `How to fix a ${c.brand} ${c.appliance.toLowerCase()} ${c.display} code`, step: c.safe.map((t) => ({ '@type': 'HowToStep', text: t })) });
}

// ---- renderers -------------------------------------------------------------
function renderPart(p, slug, appliance) {
  if (p.free) {
    return `<div class="part">
        <div class="part-top"><span class="part-diff" style="color:#39ff14;border-color:#39ff1455">Free fix</span><span class="part-price">Free</span></div>
        <h3>${esc(p.name)}</h3>
        <p class="part-note">${esc(p.note)}</p>
        <span class="part-free">✅ No part needed — try this first</span>
      </div>`;
  }
  const [label, color] = DIFF[p.diff];
  return `<div class="part">
        <div class="part-top"><span class="part-diff" style="color:${color};border-color:${color}55">${label}</span><span class="part-price">${esc(p.price)}</span></div>
        <h3>${esc(p.name)}</h3>
        <p class="part-note">${esc(p.note)}</p>
        <div class="part-btns">
          <a class="btn-oem" href="${orderOem(p.name, appliance, slug)}">🔧 Genuine OEM — through us →</a>
          <a class="btn-amz" href="${amz(p.terms)}" target="_blank" rel="noopener sponsored">🔎 Budget on Amazon →</a>
        </div>
      </div>`;
}
function renderTools() {
  return UNIVERSAL_TOOLS.map((t) => `<div class="tool"><h3>${esc(t.name)}</h3><p>${esc(t.why)}</p><a class="tool-btn" href="${amz(t.terms)}" target="_blank" rel="noopener sponsored">🔎 On Amazon →</a></div>`).join('\n      ');
}

function renderPage(c) {
  const causeList = c.likely.map((x) => `<li>${esc(tc(x))}</li>`).join('');
  const partCards = c.parts.map((p) => renderPart(p, c.slug, c.appliance)).join('\n      ');
  const toolCards = renderTools();
  const faq = c.faq.map((f) => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join('');
  const related = c.related.map(([slug, label]) => `<a href="/${slug}" class="related-link">${esc(label)}</a>`).join('');
  const bench = c.bench ? `<p class="disclaimer-top" style="border-left-color:var(--green);background:rgba(57,255,20,.04)">🔧 <b>From our repair bench:</b> ${esc(c.bench)}</p>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(c.desc)}">
<meta name="keywords" content="${esc(c.keywords)}">
<link rel="canonical" href="https://applianceant.com/${c.slug}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#050505">
<meta property="og:type" content="article">
<meta property="og:url" content="https://applianceant.com/${c.slug}">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.desc)}">
<meta property="og:site_name" content="Appliance Ant">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(c.title)}">
<meta name="twitter:description" content="${esc(c.desc)}">
<script type="application/ld+json">${faqSchema(c)}</script>
<script type="application/ld+json">${howToSchema(c)}</script>
<script type="application/ld+json">${breadcrumbSchema(c)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Geist+Mono:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--black:#050505;--surface:#0c0c0c;--surf2:#111;--border:#1a1a1a;--bord2:#252525;--orange:#ff6200;--oran2:#ff7c28;--green:#39ff14;--white:#f0f0f0;--gray:#9a9a9a;--gray2:#333;--mono:'Geist Mono',monospace;--serif:'Instrument Serif',serif;--block:'Bebas Neue',sans-serif}
html,body{background:#050505 !important;color:#f0f0f0;font-family:var(--mono);overflow-x:hidden;scroll-behavior:smooth}
.bg{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.bg-orb{position:absolute;border-radius:50%;filter:blur(160px);animation:breathe 9s ease-in-out infinite alternate}
.orb1{width:820px;height:820px;background:radial-gradient(circle,rgba(255,98,0,.09),transparent 70%);top:-320px;left:-220px}
.orb2{width:520px;height:520px;background:radial-gradient(circle,rgba(57,255,20,.03),transparent 70%);bottom:-120px;right:-120px;animation-delay:4s}
@keyframes breathe{from{transform:scale(1);opacity:.5}to{transform:scale(1.2);opacity:1}}
.bg::after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,98,0,.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,98,0,.012) 1px,transparent 1px);background-size:72px 72px}
.shell{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column;background:#050505}
nav{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid var(--border);background:rgba(5,5,5,.9);backdrop-filter:blur(24px);position:sticky;top:0;z-index:100}
.nav-brand{display:flex;align-items:center;gap:10px;text-decoration:none}
.nav-ant{font-size:24px;animation:glow 3s ease-in-out infinite}
@keyframes glow{0%,100%{filter:drop-shadow(0 0 8px rgba(255,98,0,.5))}50%{filter:drop-shadow(0 0 22px rgba(255,98,0,.95))}}
.nav-name{font-family:var(--block);font-size:18px;letter-spacing:.08em;color:var(--white);line-height:1}
.nav-tag{font-size:9px;color:var(--gray);letter-spacing:.1em;text-transform:uppercase;margin-top:2px}
.pill{display:flex;align-items:center;gap:7px;font-size:10px;color:var(--green);border:1px solid rgba(57,255,20,.2);border-radius:20px;padding:5px 12px;background:rgba(57,255,20,.03);letter-spacing:.07em;text-transform:uppercase}
.pill-dot{width:5px;height:5px;background:var(--green);border-radius:50%;animation:pdot 2s ease-in-out infinite}
@keyframes pdot{0%,100%{box-shadow:0 0 0 0 rgba(57,255,20,.5)}50%{box-shadow:0 0 0 5px rgba(57,255,20,0)}}
.hero{padding:60px 32px 40px;max-width:900px;margin:0 auto;width:100%;animation:hero-in .8s ease forwards;opacity:0}
@keyframes hero-in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.breadcrumb{font-size:11px;color:var(--gray);letter-spacing:.06em;margin-bottom:22px}
.breadcrumb a{color:var(--gray);text-decoration:none;transition:color .2s}
.breadcrumb a:hover{color:var(--orange)}
.breadcrumb span{color:var(--gray2);margin:0 8px}
.hero-icon{font-size:46px;margin-bottom:14px;display:block}
.hero-label{font-size:11px;color:var(--orange);letter-spacing:.13em;text-transform:uppercase;margin-bottom:14px}
.codebadge{display:inline-block;font-family:var(--block);font-size:13px;letter-spacing:.14em;color:var(--green);border:1px solid rgba(57,255,20,.3);border-radius:8px;padding:5px 12px;margin-bottom:16px;background:rgba(57,255,20,.04)}
h1{font-family:var(--block);font-size:clamp(42px,8vw,76px);letter-spacing:.02em;line-height:.94;margin-bottom:20px;color:var(--white)}
h1 em{color:var(--orange);font-style:normal;display:block}
.quick{background:linear-gradient(135deg,rgba(255,98,0,.08),rgba(255,98,0,.02));border:1px solid rgba(255,98,0,.25);border-radius:14px;padding:24px 26px;margin-top:8px;position:relative}
.quick::before{content:'THE HONEST ANSWER';position:absolute;top:-9px;left:20px;background:#050505;font-family:var(--block);font-size:11px;letter-spacing:.14em;color:var(--orange);padding:0 8px}
.quick p{font-size:14.5px;color:var(--white);line-height:1.75}
.content{max-width:900px;margin:0 auto;padding:0 32px 70px;width:100%}
.section{margin-bottom:52px;border-top:1px solid var(--border);padding-top:44px}
.section:first-child{border-top:none;padding-top:0}
.klabel{font-size:11px;color:var(--orange);letter-spacing:.13em;text-transform:uppercase;margin-bottom:12px}
h2{font-family:var(--block);font-size:clamp(28px,5vw,42px);letter-spacing:.03em;line-height:1.05;margin-bottom:14px;color:var(--white)}
.prose{font-size:14px;color:var(--gray);line-height:1.85}
.prose strong{color:var(--white);font-weight:500}
.meaning-box{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:22px 24px;margin-top:6px}
.meaning-box .m{font-size:16px;color:var(--white);line-height:1.6;margin-bottom:14px}
.meaning-box ul{margin:0;padding-left:20px;font-size:13.5px;color:var(--gray);line-height:1.8}
.meaning-box li{margin-bottom:6px}
.testbox{background:var(--surface);border:1px solid var(--bord2);border-left:3px solid var(--green);border-radius:0 12px 12px 0;padding:20px 24px;margin-top:20px;font-size:14px;color:var(--white);line-height:1.7}
.testbox b{color:var(--green)}
.cause-list{display:flex;flex-direction:column;gap:12px;margin-top:20px}
.cause{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px}
.cause h3{font-family:var(--block);font-size:17px;letter-spacing:.03em;color:var(--white);margin-bottom:7px}
.cause ul{margin:0;padding-left:18px;font-size:13px;color:var(--gray);line-height:1.75}
.cause li{margin-bottom:7px}
.cause li:last-child{margin-bottom:0}
.parts{display:grid;grid-template-columns:repeat(2,1fr);gap:13px;margin-top:22px}
.part{background:var(--surface);border:1px solid var(--bord2);border-radius:14px;padding:22px 22px;display:flex;flex-direction:column;transition:all .2s}
.part:hover{border-color:rgba(255,98,0,.45);transform:translateY(-2px)}
.part-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.part-diff{font-size:10px;letter-spacing:.07em;text-transform:uppercase;border:1px solid;border-radius:14px;padding:4px 10px}
.part-price{font-family:var(--block);font-size:18px;color:var(--white);letter-spacing:.03em}
.part h3{font-family:var(--block);font-size:19px;letter-spacing:.03em;color:var(--white);margin-bottom:6px}
.part-note{font-size:11.5px;color:var(--gray);line-height:1.55;margin-bottom:12px}
.part-free{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--green);border:1px solid rgba(57,255,20,.25);border-radius:10px;padding:11px 14px;margin-top:auto;letter-spacing:.02em}
.part-btns{display:flex;flex-direction:column;gap:8px;margin-top:auto}
.btn-oem{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--orange);color:#000;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:12px 16px;border-radius:10px;text-decoration:none;transition:all .2s}
.btn-oem:hover{background:var(--oran2);transform:translateY(-1px);box-shadow:0 6px 18px rgba(255,98,0,.28)}
.btn-amz{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:transparent;color:var(--white);border:1px solid var(--bord2);font-family:var(--mono);font-size:12px;letter-spacing:.04em;text-transform:uppercase;padding:11px 16px;border-radius:10px;text-decoration:none;transition:all .2s}
.btn-amz:hover{border-color:var(--orange);color:var(--orange)}
.disclosure{font-size:11px;color:var(--gray2);line-height:1.6;margin-top:16px;letter-spacing:.02em}
.disclaimer-top{font-size:12.5px;color:var(--gray);line-height:1.7;margin-top:16px;padding:14px 18px;border-left:3px solid var(--orange);background:rgba(255,98,0,.04);border-radius:0 8px 8px 0}
.disclaimer-top b{color:var(--white)}
.tools{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:20px}
.tool{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px;display:flex;flex-direction:column}
.tool h3{font-family:var(--block);font-size:16px;color:var(--white);letter-spacing:.03em;margin-bottom:7px}
.tool p{font-size:12.5px;color:var(--gray);line-height:1.6;margin-bottom:14px}
.tool-btn{margin-top:auto;display:inline-flex;align-items:center;justify-content:center;gap:7px;background:transparent;border:1px solid var(--bord2);color:var(--white);font-size:11px;letter-spacing:.04em;text-transform:uppercase;padding:10px 14px;border-radius:9px;text-decoration:none;transition:all .2s}
.tool-btn:hover{border-color:var(--orange);color:var(--orange)}
.local{background:linear-gradient(135deg,rgba(255,98,0,.08),rgba(255,98,0,.02));border:1px solid rgba(255,98,0,.28);border-radius:18px;padding:34px 30px;text-align:center}
.local h3{font-family:var(--block);font-size:27px;letter-spacing:.03em;color:var(--white);margin-bottom:10px}
.local p{font-size:14px;color:#d2d2d2;line-height:1.7;margin-bottom:20px}
.local p b{color:var(--white)}
.local .areas{margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,98,0,.18);display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center}
.local .areas span{font-size:11px;color:var(--gray);letter-spacing:.06em;text-transform:uppercase}
.local .areas a{font-size:12px;color:var(--white);text-decoration:none;border:1px solid var(--bord2);border-radius:999px;padding:6px 12px;transition:all .2s}
.local .areas a:hover{border-color:var(--orange);color:var(--orange)}
.btn-primary{display:inline-flex;align-items:center;gap:9px;background:var(--orange);color:#000;font-family:var(--mono);font-size:13px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:15px 28px;border-radius:11px;text-decoration:none;transition:all .2s;box-shadow:0 6px 24px rgba(255,98,0,.22)}
.btn-primary:hover{background:var(--oran2);transform:translateY(-2px);box-shadow:0 10px 30px rgba(255,98,0,.34)}
.faq{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.faq-item{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px;transition:border-color .2s}
.faq-item:hover{border-color:rgba(255,98,0,.4)}
.faq-q{font-size:14px;color:var(--white);font-weight:500;margin-bottom:9px}
.faq-a{font-size:13px;color:var(--gray);line-height:1.75}
.related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:20px}
.related-link{background:var(--surface);border:1px solid var(--bord2);border-radius:10px;padding:16px 18px;text-decoration:none;color:var(--white);font-size:13px;letter-spacing:.02em;transition:all .2s;display:flex;align-items:center;gap:10px}
.related-link:hover{border-color:var(--orange);color:var(--orange)}
.related-link::after{content:'→';margin-left:auto;color:var(--gray);transition:color .2s,transform .2s}
.related-link:hover::after{color:var(--orange);transform:translateX(4px)}
footer{border-top:1px solid var(--border);padding:30px 32px 42px;text-align:center;background:#050505;margin-top:20px}
.foot-links{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-bottom:12px}
.foot-links a{font-size:11px;color:var(--gray);text-decoration:none;letter-spacing:.04em;transition:color .2s}
.foot-links a:hover{color:var(--orange)}
.foot-tag{font-size:10px;color:var(--gray2);letter-spacing:.08em;text-transform:uppercase;line-height:1.7}
@media(max-width:760px){.parts{grid-template-columns:1fr}.related-grid{grid-template-columns:1fr}.tools{grid-template-columns:1fr}.hero{padding:44px 20px 30px}.content{padding:0 20px 54px}nav{padding:14px 18px}.nav-tag{display:none}}
</style>
</head>
<body>
<div class="bg"><div class="bg-orb orb1"></div><div class="bg-orb orb2"></div></div>
<div class="shell">

<nav>
<a href="/" class="nav-brand"><span class="nav-ant">🐜</span><div><div class="nav-name">APPLIANCE ANT</div><div class="nav-tag">Fix it honestly.</div></div></a>
<div class="pill"><span class="pill-dot"></span>Nationwide DIY + Parts</div>
</nav>

<div class="hero">
  <div class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/fault-codes">Fault Codes</a><span>›</span>${esc(c.brand)} ${esc(c.applName)} ${esc(c.display)}</div>
  <span class="hero-icon">${c.icon}</span>
  <div class="hero-label">${esc(c.brand)} ${esc(c.applName)} · Error Code</div>
  <span class="codebadge">CODE ${esc(c.display)}${c.alt ? ` · also shows ${esc(c.alt)}` : ''}</span>
  <h1>${esc(c.brand)} ${esc(c.display)}<em>${esc(c.meaning)}</em></h1>
  <div class="quick"><p>${esc(c.quick)}</p></div>
  ${bench}
  <p class="disclaimer-top">🐜 <b>Straight talk:</b> this points you at the likely cause — it's not a guarantee, and every machine is different. Cut the power (and shut off gas or water) before you touch anything, test to confirm the part is actually bad before you buy, and if it's beyond you, get a pro. No shame in that.</p>
</div>

<div class="content">

  <section class="section">
    <div class="klabel">What the code means</div>
    <h2>${esc(c.display)}: ${esc(c.meaning)}</h2>
    <div class="meaning-box">
      <div class="m">${esc(c.meaning)}.</div>
      <div style="font-size:12px;color:var(--orange);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Most likely causes</div>
      <ul>${causeList}</ul>
    </div>
    <div class="testbox"><b>The 2-minute test →</b> ${esc(c.test)}</div>
  </section>

  <section class="section">
    <div class="klabel">The kit</div>
    <h2>The Tools to Test + Fix With</h2>
    <p class="prose">You don't need a shop full of tools — you need these. The multimeter is the one that pays for itself the first time it stops you buying the wrong part on a fault code.</p>
    <div class="tools">
      ${toolCards}
    </div>
  </section>

  <section class="section">
    <div class="klabel">Fix it — two honest options</div>
    <h2>The Fix — Free Checks First, Then the Part</h2>
    <p class="prose">Work top-down: the free checks before you spend a dime, and <strong>test to confirm the part is actually bad before you buy.</strong> When it is a part, you get <strong>both options</strong> — the genuine OEM part sourced through us and shipped to your door, or a budget aftermarket part on Amazon. Your call.</p>
    <div class="parts">
      ${partCards}
    </div>
    <p class="disclosure">Prices shown are typical aftermarket ranges and vary by brand and model — genuine OEM is priced by quote when you request it. Amazon links open a search so you can match your exact model number; as an Amazon Associate, Appliance Ant may earn from qualifying purchases at no extra cost to you. Always confirm the part fits your model.</p>
  </section>

  <section class="section">
    <div class="klabel">Can you fix it yourself?</div>
    <h2>Safe to Try · Know the Risk · Call a Pro</h2>
    <p class="prose">General guidance, not professional advice. <strong>Always unplug the appliance (or shut off the gas/water) before you check anything.</strong> If it feels beyond you, that's exactly when to get a pro.</p>
    <div class="cause-list">
      <div class="cause" style="border-left:3px solid var(--green)"><h3>✅ Safe to try yourself</h3><ul>${c.safe.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="cause" style="border-left:3px solid var(--orange)"><h3>⚠️ Doable — know the risk</h3><ul>${c.risk.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="cause" style="border-left:3px solid #ff3b30"><h3>🛑 Call a pro — don't touch this</h3><ul>${c.pro.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
    </div>
  </section>

  <section class="section">
    <div class="klabel">Is it worth fixing?</div>
    <h2>The Honest Call</h2>
    <p class="prose">${esc(c.worth)}</p>
  </section>

  <section class="section">
    <div class="local">
      <h3>In Middle Tennessee or Louisiana?</h3>
      <p>Don't want to DIY it? <b>Our own family of technicians</b> will come clear that ${esc(c.display)} for you — honest flat pricing, usually same-day, 4.5★ from 1,000+ neighbors.</p>
      <a href="${REPAIR}/same-day-appliance-repair" class="btn-primary">🔧 Get it fixed by our techs →</a>
      <div class="areas"><span>We come to:</span><a href="${REPAIR}/walker">Walker, LA</a><a href="${REPAIR}/baton-rouge">Baton Rouge, LA</a><a href="${REPAIR}/hammond">Hammond, LA</a><a href="${REPAIR}/new-orleans">New Orleans, LA</a><a href="${REPAIR}/nashville">Nashville, TN</a><a href="${REPAIR}/murfreesboro">Murfreesboro, TN</a><a href="${REPAIR}/clarksville">Clarksville, TN</a><a href="${REPAIR}/franklin">Franklin, TN</a></div>
    </div>
  </section>

  <section class="section">
    <div class="klabel">FAQ</div>
    <h2>People Also Ask</h2>
    <div class="faq">${faq}</div>
  </section>

  <section class="section">
    <div class="klabel">Related codes</div>
    <h2>Other Codes &amp; Fixes</h2>
    <div class="related-grid">${related}</div>
  </section>

</div>

<footer>
  <div class="foot-links">
    <a href="/">Appliance Ant Home</a>
    <a href="/fault-codes">All Fault Codes</a>
    <a href="${REPAIR}">TN Appliance Exchange (local repair)</a>
    <a href="${REPAIR}/privacy">Privacy</a>
  </div>
  <div class="foot-tag">🐜 Appliance Ant · built by the family behind TN Appliance Exchange · in the trade since 2012 · nationwide DIY help + parts</div>
</footer>

</div>
</body>
</html>
`;
}

// ---- hub page (/fault-codes) -----------------------------------------------
function renderHub(list) {
  const brands = [];
  for (const c of list) { if (!brands.includes(c.brand)) brands.push(c.brand); }
  const groups = brands.map((b) => {
    const rows = list.filter((c) => c.brand === b).map((c) =>
      `<a class="code-row" href="/${c.slug}"><span class="code-tag">${esc(c.display)}</span><span class="code-appl">${esc(c.icon)} ${esc(c.applName)}</span><span class="code-mean">${esc(c.meaning)}</span><span class="code-go">→</span></a>`
    ).join('\n      ');
    return `<div class="brand-group"><h3 class="brand-h">${esc(b)}</h3><div class="code-list">${rows}</div></div>`;
  }).join('\n    ');
  const title = 'Appliance Fault & Error Codes — What They Mean + How to Fix Them';
  const desc = 'Look up your appliance error code — Samsung, LG, Whirlpool, Frigidaire, Bosch, GE. What the code means, the real cause, the 2-minute test, and the exact part. From real techs.';
  const guideChips = [['dryer-not-heating','Dryer not heating'],['washer-not-draining','Washer not draining'],['refrigerator-not-cooling','Fridge not cooling'],['dishwasher-not-draining','Dishwasher not draining'],['oven-not-heating','Oven not heating']]
    .map(([s,l]) => `<a href="/${s}">${l} →</a>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="appliance error codes, appliance fault codes, samsung error code, lg error code, whirlpool fault code, frigidaire error code, bosch error code, ge error code, what does my appliance code mean">
<link rel="canonical" href="https://applianceant.com/fault-codes">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#050505">
<meta property="og:type" content="website">
<meta property="og:url" content="https://applianceant.com/fault-codes">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="Appliance Ant">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://applianceant.com/' },
  { '@type': 'ListItem', position: 2, name: 'Fault Codes', item: 'https://applianceant.com/fault-codes' },
] })}</script>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Appliance fault codes', itemListElement: list.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: `${c.brand} ${c.applName} ${c.display}`, url: `https://applianceant.com/${c.slug}` })) })}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Geist+Mono:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--black:#050505;--surface:#0c0c0c;--border:#1a1a1a;--bord2:#252525;--orange:#ff6200;--oran2:#ff7c28;--green:#39ff14;--white:#f0f0f0;--gray:#9a9a9a;--gray2:#333;--mono:'Geist Mono',monospace;--block:'Bebas Neue',sans-serif}
html,body{background:#050505 !important;color:#f0f0f0;font-family:var(--mono);overflow-x:hidden;scroll-behavior:smooth}
.bg{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.bg-orb{position:absolute;border-radius:50%;filter:blur(160px);animation:breathe 9s ease-in-out infinite alternate}
.orb1{width:820px;height:820px;background:radial-gradient(circle,rgba(255,98,0,.09),transparent 70%);top:-320px;left:-220px}
@keyframes breathe{from{transform:scale(1);opacity:.5}to{transform:scale(1.2);opacity:1}}
.bg::after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,98,0,.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,98,0,.012) 1px,transparent 1px);background-size:72px 72px}
.shell{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column;background:#050505}
nav{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid var(--border);background:rgba(5,5,5,.9);backdrop-filter:blur(24px);position:sticky;top:0;z-index:100}
.nav-brand{display:flex;align-items:center;gap:10px;text-decoration:none}
.nav-ant{font-size:24px;animation:glow 3s ease-in-out infinite}
@keyframes glow{0%,100%{filter:drop-shadow(0 0 8px rgba(255,98,0,.5))}50%{filter:drop-shadow(0 0 22px rgba(255,98,0,.95))}}
.nav-name{font-family:var(--block);font-size:18px;letter-spacing:.08em;color:var(--white);line-height:1}
.nav-tag{font-size:9px;color:var(--gray);letter-spacing:.1em;text-transform:uppercase;margin-top:2px}
.pill{display:flex;align-items:center;gap:7px;font-size:10px;color:var(--green);border:1px solid rgba(57,255,20,.2);border-radius:20px;padding:5px 12px;background:rgba(57,255,20,.03);letter-spacing:.07em;text-transform:uppercase}
.pill-dot{width:5px;height:5px;background:var(--green);border-radius:50%}
.hero{padding:60px 32px 30px;max-width:960px;margin:0 auto;width:100%}
.breadcrumb{font-size:11px;color:var(--gray);letter-spacing:.06em;margin-bottom:22px}
.breadcrumb a{color:var(--gray);text-decoration:none}
.breadcrumb a:hover{color:var(--orange)}
.breadcrumb span{color:var(--gray2);margin:0 8px}
.hero-label{font-size:11px;color:var(--orange);letter-spacing:.13em;text-transform:uppercase;margin-bottom:14px}
h1{font-family:var(--block);font-size:clamp(40px,7vw,68px);letter-spacing:.02em;line-height:.96;margin-bottom:18px;color:var(--white)}
h1 em{color:var(--orange);font-style:normal}
.lede{font-size:14.5px;color:var(--gray);line-height:1.8;max-width:680px}
.lede b{color:var(--white)}
.content{max-width:960px;margin:0 auto;padding:10px 32px 70px;width:100%}
.brand-group{margin-top:40px}
.brand-h{font-family:var(--block);font-size:26px;letter-spacing:.05em;color:var(--white);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.code-list{display:flex;flex-direction:column;gap:8px}
.code-row{display:grid;grid-template-columns:80px 150px 1fr 20px;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--bord2);border-radius:10px;padding:14px 18px;text-decoration:none;transition:all .2s}
.code-row:hover{border-color:var(--orange);transform:translateX(3px)}
.code-tag{font-family:var(--block);font-size:16px;letter-spacing:.06em;color:var(--green)}
.code-appl{font-size:12px;color:var(--gray);letter-spacing:.03em}
.code-mean{font-size:13px;color:var(--white)}
.code-go{color:var(--gray);text-align:right}
.code-row:hover .code-go{color:var(--orange)}
.guides{margin-top:46px;border-top:1px solid var(--border);padding-top:34px}
.guides h2{font-family:var(--block);font-size:26px;letter-spacing:.04em;color:var(--white);margin-bottom:8px}
.guides p{font-size:13.5px;color:var(--gray);margin-bottom:16px}
.chips{display:flex;flex-wrap:wrap;gap:9px}
.chips a{font-size:12.5px;color:var(--white);text-decoration:none;border:1px solid var(--bord2);border-radius:999px;padding:9px 15px;transition:all .2s}
.chips a:hover{border-color:var(--orange);color:var(--orange)}
footer{border-top:1px solid var(--border);padding:30px 32px 42px;text-align:center;background:#050505;margin-top:30px}
.foot-links{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-bottom:12px}
.foot-links a{font-size:11px;color:var(--gray);text-decoration:none;letter-spacing:.04em}
.foot-links a:hover{color:var(--orange)}
.foot-tag{font-size:10px;color:var(--gray2);letter-spacing:.08em;text-transform:uppercase;line-height:1.7}
@media(max-width:680px){.code-row{grid-template-columns:64px 1fr 18px;gap:10px}.code-appl{display:none}.hero{padding:44px 20px 24px}.content{padding:6px 20px 54px}nav{padding:14px 18px}.nav-tag{display:none}}
</style>
</head>
<body>
<div class="bg"><div class="bg-orb orb1"></div></div>
<div class="shell">
<nav>
<a href="/" class="nav-brand"><span class="nav-ant">🐜</span><div><div class="nav-name">APPLIANCE ANT</div><div class="nav-tag">Fix it honestly.</div></div></a>
<div class="pill"><span class="pill-dot"></span>Nationwide DIY + Parts</div>
</nav>
<div class="hero">
  <div class="breadcrumb"><a href="/">Home</a><span>›</span>Fault Codes</div>
  <div class="hero-label">Error-code lookup</div>
  <h1>Appliance <em>Fault Codes</em>, Decoded.</h1>
  <p class="lede">Your machine flashed a code. Find it below and get the straight answer: <b>what it means, the real cause, the 2-minute test, and the exact part</b> — from a family that's fixed these for a living since 2012. Free checks first, always. Then buy the part from us or grab a budget one on Amazon — your call.</p>
</div>
<div class="content">
    ${groups}
  <div class="guides">
    <h2>No code? Start with the symptom</h2>
    <p>Not every breakdown throws a code. If yours didn't, start here:</p>
    <div class="chips">${guideChips}</div>
  </div>
</div>
<footer>
  <div class="foot-links">
    <a href="/">Appliance Ant Home</a>
    <a href="${REPAIR}">TN Appliance Exchange (local repair)</a>
    <a href="${REPAIR}/privacy">Privacy</a>
  </div>
  <div class="foot-tag">🐜 Appliance Ant · built by the family behind TN Appliance Exchange · in the trade since 2012 · nationwide DIY help + parts</div>
</footer>
</div>
</body>
</html>
`;
}

// ---- run -------------------------------------------------------------------
const built = CODES.map(enrich);
// slug collision guard
const seen = {};
for (const c of built) { if (seen[c.slug]) throw new Error('slug collision: ' + c.slug); seen[c.slug] = 1; }

let written = [];
for (const c of built) {
  fs.writeFileSync(path.join(OUT, `${c.slug}.html`), renderPage(c), 'utf8');
  written.push(c.slug);
  console.log(`  ✓ ${c.slug}.html  (${c.brand} ${c.appliance} ${c.display})`);
}
fs.writeFileSync(path.join(OUT, 'fault-codes.html'), renderHub(built), 'utf8');
console.log('  ✓ fault-codes.html  (hub)');

// ---- merge into sitemap.xml (don't clobber symptom URLs) --------------------
const smPath = path.join(OUT, 'sitemap.xml');
let existing = [];
if (fs.existsSync(smPath)) {
  const raw = fs.readFileSync(smPath, 'utf8');
  existing = (raw.match(/<url>[\s\S]*?<\/url>/g) || []);
}
const haveLoc = new Set(existing.map((b) => (b.match(/<loc>([^<]+)<\/loc>/) || [])[1]));
const codeUrls = built
  .map((c) => `https://applianceant.com/${c.slug}`)
  .filter((loc) => !haveLoc.has(loc))
  .map((loc) => `<url><loc>${loc}</loc><lastmod>${LASTMOD}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`);
const faultHub = haveLoc.has('https://applianceant.com/fault-codes') ? [] : [`<url><loc>https://applianceant.com/fault-codes</loc><lastmod>${LASTMOD}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`];
const merged = existing.concat(faultHub).concat(codeUrls);
fs.writeFileSync(smPath, '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + merged.join('\n') + '\n</urlset>\n', 'utf8');

console.log(`\nWrote ${written.length} fault-code pages. Sitemap now ${merged.length} urls (+${codeUrls.length + faultHub.length}).`);
module.exports = { CODES: built };
