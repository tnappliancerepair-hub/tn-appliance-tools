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

  // ══════════════════════ WAVE 2 ══════════════════════
  // ── Samsung fridge (high volume) ────────────────────────────────────────────
  { family: 'samsung', appliance: 'Refrigerator', code: '5C', brand: 'Samsung', display: '5C', alt: '5E',
    quick: "A Samsung 5C (older: 5E) on a refrigerator is a fridge defrost-sensor fault — the sensor that tells the fridge when to run a defrost is out of range, so frost creeps onto the coil and cooling slips. It usually rides with visible ice buildup. Force a defrost or unplug 24 hours to melt the ice first; if 5C comes back, replace the defrost temperature sensor.",
    bench: "5C almost always shows up with a frost problem — thaw it out fully and see if it clears before you order the sensor.",
    parts: [
      { free: true, name: 'No part — force defrost / thaw it out', note: 'Unplug 24 hours (cooler your food) or run the force-defrost sequence to melt frost off the coil. Clears many 5C codes.' },
      { name: 'Defrost temperature sensor', diff: 'moderate', price: '$15–40', terms: 'samsung refrigerator defrost temperature sensor', note: 'If 5C returns after thawing. It clips near the evaporator behind the back panel. Match your model.' },
    ],
    safe: ['Check the freezer/fridge back panel for heavy frost.', 'Force-defrost or unplug 24 hours to melt the ice.', 'Make sure vents inside aren\'t blocked and the doors seal.'],
    risk: ['Defrost sensor replacement — moderate; unplug, remove the interior back panel, let ice melt first.'],
    pro: ['A repeating defrost failure (heater/board) that keeps re-icing the coil.'],
    worth: "Worth it — a defrost sensor is $15–40 and never a reason to replace an otherwise-good fridge.",
    faq: [
      { q: 'What does 5C mean on a Samsung refrigerator?', a: 'A fridge defrost-sensor fault (older displays show 5E) — the defrost temperature sensor is out of range, so frost builds on the coil and cooling drops.' },
      { q: 'How do I fix a Samsung refrigerator 5C code?', a: 'Force a defrost or unplug the fridge 24 hours to melt the ice off the coil. If 5C returns, replace the defrost temperature sensor behind the back panel.' },
    ],
    related: [['samsung-refrigerator-22c', 'Samsung Fridge 22C'], ['samsung-refrigerator-21c', 'Samsung Fridge 21C'], ['refrigerator-not-cooling', 'Fridge Not Cooling'] ] },

  { family: 'samsung', appliance: 'Refrigerator', code: '21C', brand: 'Samsung', display: '21C', alt: '21E',
    quick: "A Samsung 21C (older: 21E) is a freezer fan error — the freezer's evaporator fan isn't spinning right, usually because it's iced over or the fan motor failed. The freezer warms up and ice production drops. Thaw it out first; if the fan is still dead or grinding after it clears, replace the freezer fan motor.",
    bench: "21C is a fan that's either jammed in frost or burned out — thaw first, and only order the motor if it's still dead after the ice is gone.",
    parts: [
      { free: true, name: 'No part — thaw the iced fan', note: 'Frost jamming the freezer fan throws 21C. Force-defrost or unplug 24–48 hours and listen for the fan to free up.' },
      { name: 'Freezer evaporator fan motor', diff: 'moderate', price: '$30–80', terms: 'samsung refrigerator freezer fan motor', note: 'If the fan is still dead or noisy after thawing. Behind the freezer back panel. Match your model.' },
    ],
    safe: ['Listen at the freezer back panel for a dead or grinding fan.', 'Check for heavy frost jamming the fan.', 'Force-defrost or unplug 24–48h and see if the fan frees up.'],
    risk: ['Freezer fan motor replacement — moderate; unplug, remove the interior back panel, melt ice first.'],
    pro: ['A repeating defrost failure that keeps re-icing the fan.'],
    worth: "Worth it — a fan motor is $30–80 versus a whole new fridge.",
    faq: [
      { q: 'What does 21C mean on a Samsung refrigerator?', a: 'A freezer evaporator fan error (older displays show 21E) — the freezer fan isn\'t running right, usually iced over or a failed fan motor.' },
      { q: 'How do I fix a Samsung 21C code?', a: 'Force a defrost or unplug the fridge 24–48 hours to melt frost jamming the fan. If it\'s still dead after thawing, replace the freezer evaporator fan motor.' },
    ],
    related: [['samsung-refrigerator-22c', 'Samsung Fridge 22C'], ['samsung-refrigerator-5c', 'Samsung Fridge 5C'], ['freezer-not-freezing', 'Freezer Not Freezing'] ] },

  { family: 'samsung', appliance: 'Refrigerator', code: '39C', brand: 'Samsung', display: '39C', alt: '39E',
    quick: "A Samsung 39C (older: 39E) is an ice-maker function error — the ice maker isn't cycling or ejecting ice. The most common cause is frost jamming the ice-maker mechanism, so a force-defrost (or the ice-maker reset) clears many of them for free. If it still won't make ice after thawing, the ice-maker assembly has failed. Check the water filter and line too.",
    bench: "39C is usually a frozen-up ice maker — run the force-defrost / ice-maker test before you buy the assembly.",
    parts: [
      { free: true, name: 'No part — force defrost & reset the ice maker', note: 'Frost locks the ice-maker mechanism. Force-defrost or unplug 24h to thaw, then run the ice-maker test/reset. Clears many 39C codes.' },
      { name: 'Water filter (if overdue)', diff: 'easy', price: '$25–55', terms: 'samsung refrigerator water filter', note: 'An overdue filter starves the ice maker of water. Buy the filter for your exact model.' },
      { name: 'Ice maker assembly', diff: 'moderate', price: '$60–160', terms: 'samsung refrigerator ice maker assembly', note: 'If it still won\'t cycle after thawing and the water\'s reaching it. Match your model.' },
    ],
    safe: ['Force-defrost or unplug 24h to thaw the ice-maker area.', 'Run the ice-maker test/reset button sequence for your model.', 'Replace the water filter if it\'s older than 6 months; confirm the water line isn\'t frozen or kinked.'],
    risk: ['Ice maker assembly replacement — moderate; unplug, unbolt the assembly, transfer the connector.'],
    pro: ['A sealed-system frost problem behind the ice maker, or a new water line into the wall.'],
    worth: "Worth it — a filter is cheap and the ice-maker assembly is $60–160, far under a new fridge. Thaw and reset before buying anything.",
    faq: [
      { q: 'What does 39C mean on a Samsung refrigerator?', a: 'An ice-maker function error (older displays show 39E) — the ice maker isn\'t cycling or ejecting ice, usually frost jamming it or a failed ice-maker assembly.' },
      { q: 'How do I fix a Samsung 39C code?', a: 'Force a defrost or unplug the fridge 24 hours to thaw the ice maker, then run the ice-maker reset. Check the water filter and line. If it still won\'t make ice, replace the ice-maker assembly.' },
    ],
    related: [['refrigerator-not-making-ice', 'Ice Maker Not Working'], ['samsung-refrigerator-22c', 'Samsung Fridge 22C'], ['lg-refrigerator-if', 'LG Fridge IF'] ] },

  { family: 'samsung', appliance: 'Refrigerator', code: '88 88', brand: 'Samsung', display: '88 88', alt: '',
    quick: "Good news first: 88 88 flashing on a Samsung fridge display is almost always a scrambled control panel from a power surge or brownout — not a broken part. The fix is a full power reset: unplug the fridge for 5 minutes, then plug it back in. That reboots the panel and clears it. Only if 88 88 comes right back after a clean reset is the display board or a bad connection at play.",
    bench: "88 88 is a reboot, not a repair — pull the plug for 5 minutes before anyone talks you into a control board.",
    parts: [
      { free: true, name: 'No part — full power reset', note: 'Unplug the fridge for 5 minutes (or flip its breaker off/on), then restore power. This reboots the panel and clears 88 88 in most cases.' },
      { name: 'Display / control board', diff: 'pro', price: '$80–220', terms: 'samsung refrigerator display control board', note: 'Only if 88 88 returns immediately after a clean 5-minute reset. Confirm the panel ribbon connector is seated first.' },
    ],
    safe: ['Unplug the fridge for a full 5 minutes (or flip the breaker), then restore power.', 'Check the panel is dry and the door hasn\'t trapped moisture on it.', 'Make sure the outlet is solid (not a flaky GFCI or surge strip).'],
    risk: ['Reseating the panel ribbon connector — easy-to-moderate; unplug first.'],
    pro: ['A display/main board replacement, or a wiring fault behind the panel.'],
    worth: "Free almost every time — it\'s a reboot. Don\'t pay for a board unless 88 88 survives a proper power reset.",
    faq: [
      { q: 'What does 88 88 mean on a Samsung refrigerator?', a: 'The control panel is scrambled — usually a power surge or brownout, not a hardware failure. A full 5-minute power reset almost always clears it.' },
      { q: 'How do I fix 88 88 on my Samsung fridge?', a: 'Unplug the refrigerator for 5 full minutes (or flip its breaker off and on), then restore power to reboot the panel. If 88 88 comes right back, check the panel connector or the display board.' },
    ],
    related: [['samsung-refrigerator-of-of', 'Samsung Fridge OF OF'], ['refrigerator-not-cooling', 'Fridge Not Cooling'], ['samsung-refrigerator-22c', 'Samsung Fridge 22C'] ] },

  { family: 'samsung', appliance: 'Washer', code: 'LC', brand: 'Samsung', display: 'LC', alt: 'LE / 1C',
    quick: "A Samsung LC (older: LE) means the washer's leak sensor tripped. Often it isn't a real leak — too much detergent oversuds and fools the sensor, or a small splash pooled in the base. Cut the HE detergent, run a rinse, and check the hoses and door boot. If water keeps collecting in the base, you've got a genuine leak (a hose, the pump, or the door gasket) to track down.",
    bench: "Rule out oversudsing first — LC is frequently just too much soap. Then look for where water actually pools.",
    parts: [
      { free: true, name: 'No part — cut detergent & check for a leak', note: 'Use 1–2 teaspoons of HE detergent and run a rinse to clear suds. Check the fill/drain hoses, clamps, and the door boot fold. Many LC codes clear here.' },
      { name: 'Fix the leak source (hose / pump / boot)', diff: 'moderate', price: '$15–90', terms: 'samsung washer drain pump door boot hose', note: 'If water keeps pooling in the base, find and replace the leaking part — a hose/clamp, the drain pump seal, or a torn door boot.' },
    ],
    safe: ['Reduce HE detergent to 1–2 teaspoons and run a rinse to clear suds.', 'Pull the washer out and check the fill + drain hoses and clamps.', 'On a front-loader, wipe the door boot fold and check it for tears.'],
    risk: ['Replacing a leaking hose, pump seal, or door boot — moderate; power and water off, expect spillage.'],
    pro: ['A leak reaching the motor/control board, or a leak you can\'t locate.'],
    worth: "Often free (just too much soap). A real leak part is $15–90 — still far under a new washer.",
    faq: [
      { q: 'What does LC mean on a Samsung washer?', a: 'The leak sensor tripped (older displays show LE). Often it\'s just oversudsing from too much detergent or a small splash; sometimes a real leak from a hose, the pump, or the door boot.' },
      { q: 'How do I fix a Samsung LC code?', a: 'Cut the HE detergent to 1–2 teaspoons and run a rinse, then check the hoses, clamps, and door boot. If water keeps collecting in the base, find and replace the leaking part.' },
    ],
    related: [['samsung-washer-sud', 'Samsung Washer SUD'], ['washer-leaking-water', 'Washer Leaking'], ['bosch-dishwasher-e15', 'Bosch DW E15'] ] },

  { family: 'samsung', appliance: 'Washer', code: 'SUD', brand: 'Samsung', display: 'SUD', alt: 'Sud / SD',
    quick: "SUD (or Sd) isn't a fault — your Samsung washer detected too many suds and paused to let them settle. It's caused by too much detergent, non-HE detergent in an HE machine, or a very light load. Run a rinse/spin to clear the foam and cut way back on soap. Free fix. If SUD shows on every load with correct HE detergent, a clogged drain filter can trap suds — clean it.",
    bench: "SUD is a soap problem 99% of the time — 1 to 2 teaspoons of HE detergent, not a capful.",
    parts: [
      { free: true, name: 'No part — less HE detergent + rinse', note: 'Run a rinse/spin to clear the foam, then use only 1–2 teaspoons of HE (High-Efficiency) detergent. Non-HE soap oversuds badly in HE machines.' },
      { free: true, name: 'Also clean the drain filter', note: 'A clogged bottom-front debris filter can trap suds and re-trigger SUD. Clean it (towel down — water spills).' },
    ],
    safe: ['Run a rinse/spin cycle to clear the suds.', 'Switch to HE detergent and use only 1–2 teaspoons.', 'Clean the bottom-front debris filter if SUD keeps returning.'],
    risk: ['None — this is a detergent/cleaning fix, no parts.'],
    pro: ['Rarely needed — only if SUD persists with correct HE detergent and a clean filter (a sensor issue).'],
    worth: "Free — it\'s a detergent message, not a breakdown. The only cost is switching to the right soap and using less of it.",
    faq: [
      { q: 'What does SUD mean on a Samsung washer?', a: 'Too many suds — the washer paused to let the foam settle. It\'s caused by too much detergent or non-HE soap in an HE machine, not a fault.' },
      { q: 'How do I clear a Samsung SUD code?', a: 'Run a rinse/spin to clear the foam, then use only 1–2 teaspoons of HE detergent going forward. If it keeps happening, clean the drain filter.' },
    ],
    related: [['samsung-washer-lc', 'Samsung Washer LC'], ['whirlpool-washer-sd', 'Whirlpool Washer SD'], ['washer-not-draining', 'Washer Not Draining'] ] },

  { family: 'samsung', appliance: 'Dishwasher', code: '5C', brand: 'Samsung', display: '5C', alt: '5E',
    quick: "A Samsung dishwasher 5C (older: 5E) is a drain error — the water didn't pump out. Start free: clean the filter/sump packed with food, check the drain hose for a kink or a high-loop clog, and if a garbage disposal was just installed, confirm the knockout plug was removed. If the path is clear and it still won't drain, the drain pump is the part.",
    bench: "If a disposal was recently installed, check the knockout plug FIRST — a left-in plug is a 5C no part will fix.",
    parts: [
      { free: true, name: 'No part — clean filter, hose & knockout plug', note: 'Clean the filter/sump, straighten the drain hose, and confirm a new disposal\'s knockout plug was punched out. Clears most 5C codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–80', terms: 'samsung dishwasher drain pump', note: 'If everything upstream is clear and it still won\'t drain. Buy for your exact model.' },
    ],
    safe: ['Remove the bottom rack and clean the filter/sump of food.', 'Check the drain hose for kinks and clogs at the high loop.', 'If a disposal was just installed, confirm the knockout plug was removed.'],
    risk: ['Drain pump replacement — moderate; cut power at the breaker and shut the water off.'],
    pro: ['A leak reaching the wiring/control under the tub.'],
    worth: "Usually worth it — the top causes are free and a drain pump is $30–80 versus $500+ for a new dishwasher.",
    faq: [
      { q: 'What does 5C mean on a Samsung dishwasher?', a: 'A drain error (older displays show 5E) — the water didn\'t pump out. Usually a clogged filter, kinked drain hose, or a disposal knockout plug left in; sometimes a failed drain pump.' },
      { q: 'How do I fix a Samsung dishwasher 5C code?', a: 'Clean the filter and sump, straighten the drain hose, and check for a left-in disposal knockout plug. If it still won\'t drain, replace the drain pump.' },
    ],
    related: [['samsung-dishwasher-lc', 'Samsung DW LC'], ['dishwasher-not-draining', 'Dishwasher Not Draining'], ['lg-dishwasher-oe', 'LG DW OE'] ] },

  { family: 'samsung', appliance: 'Dishwasher', code: 'LC', brand: 'Samsung', display: 'LC', alt: 'LE',
    quick: "A Samsung dishwasher LC (older: LE) means the leak sensor in the base pan tripped. Often it's a small spill, condensation, or oversudsing rather than a real flood — dry the base and check the float moves freely. If LC returns fast, water is genuinely getting into the base from a hose, the door gasket, or the sump — find and fix that source.",
    bench: "LC is a base-pan float trip — dry it out and watch whether it returns before you chase a part.",
    parts: [
      { free: true, name: 'No part — dry the base & check the float', note: 'Soak the water out of the base pan so the anti-flood float drops. Cut rinse-aid/detergent if it\'s oversudsing. Clears a one-time LC.' },
      { name: 'Fix the leak source (hose / gasket / sump)', diff: 'moderate', price: '$15–70', terms: 'samsung dishwasher door gasket drain hose', note: 'If LC returns fast, water is still entering the base — check the door gasket, hose clamps, and sump, then replace the failed part.' },
    ],
    safe: ['Turn it off and soak the water out of the base pan so the float drops.', 'Check for oversudsing (too much detergent) and cut it back.', 'Restart — if LC clears and stays gone, it was a one-time spill.'],
    risk: ['Tracing and replacing a leaking gasket/hose — moderate; power and water off.'],
    pro: ['A leak you can\'t locate, or water reaching the wiring/control.'],
    worth: "Often free — LC is frequently a drained-pan reset. A real recurring leak means a $15–70 part, still far under a new machine.",
    faq: [
      { q: 'What does LC mean on a Samsung dishwasher?', a: 'The anti-flood leak sensor in the base pan tripped (older displays show LE). Often a small spill or oversudsing; sometimes a real leak from a hose, the door gasket, or the sump.' },
      { q: 'How do I fix a Samsung dishwasher LC code?', a: 'Soak the water out of the base pan so the float drops, and cut back detergent if it\'s sudsing. If LC comes right back, find and fix the leaking hose, gasket, or sump.' },
    ],
    related: [['samsung-dishwasher-5c', 'Samsung DW 5C'], ['bosch-dishwasher-e15', 'Bosch DW E15'], ['ge-dishwasher-c4', 'GE DW C4'] ] },

  // ── LG fridge + range ───────────────────────────────────────────────────────
  { family: 'lg', appliance: 'Refrigerator', code: 'FF', brand: 'LG', display: 'FF', alt: 'Er FF',
    quick: "An LG FF (or Er FF) is a freezer evaporator fan fault — the freezer fan isn't running normally, usually iced over or a failed fan motor. The freezer warms and cooling drops. Thaw it out first (force-defrost or unplug 24 hours); if the fan's still dead or grinding after the ice clears, replace the freezer fan motor.",
    bench: "FF is a fan jammed in frost or burned out — thaw first, order the motor only if it's still dead.",
    parts: [
      { free: true, name: 'No part — thaw the iced fan', note: 'Frost jamming the freezer fan throws FF. Force-defrost or unplug 24–48 hours and listen for the fan to free up.' },
      { name: 'Freezer evaporator fan motor', diff: 'moderate', price: '$30–80', terms: 'lg refrigerator freezer evaporator fan motor', note: 'If the fan\'s still dead or noisy after thawing. Behind the freezer back panel. Match your model.' },
    ],
    safe: ['Listen at the freezer back panel for a dead or grinding fan.', 'Check for frost buildup jamming the fan.', 'Force-defrost or unplug 24–48h and see if the fan frees.'],
    risk: ['Freezer fan motor replacement — moderate; unplug, remove the back panel, melt ice first.'],
    pro: ['A repeating defrost failure that keeps re-icing the fan.'],
    worth: "Worth it — a fan motor is $30–80, nowhere near a new fridge.",
    faq: [
      { q: 'What does FF or Er FF mean on an LG refrigerator?', a: 'A freezer evaporator fan fault — the freezer fan isn\'t running right, usually iced over or a failed fan motor, so the freezer warms up.' },
      { q: 'How do I fix an LG FF code?', a: 'Force a defrost or unplug the fridge 24–48 hours to melt frost jamming the fan. If it\'s still dead after thawing, replace the freezer evaporator fan motor.' },
    ],
    related: [['lg-refrigerator-if', 'LG Fridge IF'], ['lg-refrigerator-dh', 'LG Fridge dH'], ['freezer-not-freezing', 'Freezer Not Freezing'] ] },

  { family: 'lg', appliance: 'Refrigerator', code: 'dH', brand: 'LG', display: 'dH', alt: 'Er dH',
    quick: "An LG dH (or Er dH) is a defrost fault — a defrost cycle didn't complete, so frost builds on the evaporator coil until airflow chokes and cooling drops. The tell-tale is a thick ice sheet on the freezer back panel. Thaw it fully first; the fix is usually the defrost heater, sensor, or thermostat. It's a mid-level repair, not a dead fridge.",
    bench: "dH means defrost isn't finishing — thaw the coil, then test the defrost heater and sensor; one of them is usually open.",
    parts: [
      { free: true, name: 'No part — thaw the iced coil', note: 'Unplug 24–48 hours (cooler your food) to melt the ice sheet off the coil so the fridge can cool again while you diagnose.' },
      { name: 'Defrost heater / sensor kit', diff: 'moderate', price: '$20–60', terms: 'lg refrigerator defrost heater sensor kit', note: 'The dH fix. Test the heater and defrost sensor with a multimeter and replace the failed one. Match your model.' },
    ],
    safe: ['Check the freezer back panel for a heavy ice sheet.', 'Unplug 24–48h to melt the ice off the coil.', 'If you have a multimeter, test the defrost heater and sensor for continuity.'],
    risk: ['Defrost heater/sensor replacement — moderate; unplug, remove the interior back panel, let ice melt.'],
    pro: ['A control-board defrost fault, or repeated re-icing after a new heater.'],
    worth: "Worth it — a defrost kit is $20–60 and clears the ice problem; far under a new fridge.",
    faq: [
      { q: 'What does dH or Er dH mean on an LG refrigerator?', a: 'A defrost fault — a defrost cycle didn\'t complete, so frost buries the evaporator coil and cooling drops. Usually a bad defrost heater, sensor, or thermostat.' },
      { q: 'How do I fix an LG dH code?', a: 'Unplug the fridge 24–48 hours to melt the ice off the coil, then test the defrost heater and sensor and replace the failed part.' },
    ],
    related: [['lg-refrigerator-ff', 'LG Fridge FF'], ['lg-refrigerator-cf', 'LG Fridge CF'], ['refrigerator-not-cooling', 'Fridge Not Cooling'] ] },

  { family: 'lg', appliance: 'Refrigerator', code: 'CF', brand: 'LG', display: 'CF', alt: 'Er CF',
    quick: "An LG CF (or Er CF) is a condenser fan fault — the fan that cools the compressor at the bottom-back isn't running normally. When it seizes or clogs with dust and pet hair, the system overheats and cooling drops. Clean the fan and coils first (free); if the fan is still dead or noisy, replace the condenser fan motor.",
    bench: "CF often clears with a vacuum — the condenser fan gets choked with dust and pet hair down at the bottom-back.",
    parts: [
      { free: true, name: 'No part — clean the fan & coils', note: 'Pull the fridge out, remove the lower-back cover, and vacuum the condenser fan and coils clear of dust and pet hair. Often the whole fix.' },
      { name: 'Condenser fan motor', diff: 'moderate', price: '$25–70', terms: 'lg refrigerator condenser fan motor', note: 'If the fan is seized or noisy after cleaning. Down at the bottom-back near the compressor. Match your model.' },
    ],
    safe: ['Pull the fridge out and vacuum the condenser fan and coils at the bottom-back.', 'Spin the fan by hand (power off) — it should turn freely.', 'Clear anything blocking the fan (a fallen object, thick dust mat).'],
    risk: ['Condenser fan motor replacement — moderate; unplug, remove the lower-back cover.'],
    pro: ['A compressor or sealed-system fault behind the fan.'],
    worth: "Worth it — often free with a vacuum; a condenser fan motor is $25–70.",
    faq: [
      { q: 'What does CF or Er CF mean on an LG refrigerator?', a: 'A condenser fan fault — the fan cooling the compressor isn\'t running normally, usually clogged with dust or a failed motor, so the system overheats and cooling drops.' },
      { q: 'How do I fix an LG CF code?', a: 'Pull the fridge out, vacuum the condenser fan and coils at the bottom-back, and make sure the fan spins freely. If it\'s seized or noisy, replace the condenser fan motor.' },
    ],
    related: [['lg-refrigerator-ff', 'LG Fridge FF'], ['lg-refrigerator-dh', 'LG Fridge dH'], ['refrigerator-not-cooling', 'Fridge Not Cooling'] ] },

  { family: 'lg', appliance: 'Range', code: 'F9', brand: 'LG', display: 'F9', alt: '',
    quick: "An LG F9 means the oven isn't reaching temperature in the expected time — it's heating too slowly or not at all. On an electric oven that's usually a failed bake element (it should glow bright red); on a gas oven, a weak igniter that glows but never lights. A bad oven temp sensor can also cause it. Watch the element or burner to tell which path you're on.",
    bench: "Watch the bake element on an electric LG — if it doesn't glow fully red, that's your F9. On gas, it's the igniter.",
    parts: [
      { name: 'Bake element (electric)', diff: 'moderate', price: '$25–60', terms: 'lg oven bake element', note: 'If the element doesn\'t glow bright red or is visibly split. Two screws inside the oven — cut power first. Match your model.' },
      { name: 'Gas oven igniter (gas)', diff: 'pro', price: '$25–60', terms: 'lg gas oven igniter', note: 'If the igniter glows but never lights the burner. Gas job — shut off gas + power, or call a pro.' },
      { name: 'Oven temperature sensor', diff: 'moderate', price: '$15–40', terms: 'lg oven temperature sensor', note: 'If the element/igniter is fine but it still won\'t reach temp — a cold sensor reads ~1080Ω. Match your model.' },
    ],
    safe: ['Turn on bake and watch — a healthy electric element glows bright red across its length; a gas igniter should light the burner.', 'Check for a tripped breaker (electric ovens are 240V).', 'Confirm the oven isn\'t in a delay/timer/Sabbath mode.'],
    risk: ['Electric bake element or temp-sensor swap — moderate; cut power at the breaker (240V) first.'],
    pro: ['Anything on a gas oven — igniter, valve, or a gas smell.', 'The 240V wiring or an oven control board.'],
    worth: "Worth it for an element or sensor ($15–60) versus $700+ for a new range. A gas igniter is cheap too but a gas job.",
    faq: [
      { q: 'What does F9 mean on an LG oven?', a: 'The oven isn\'t reaching temperature in time — heating too slowly or not at all. Usually a failed electric bake element or a weak gas igniter; sometimes the oven temp sensor.' },
      { q: 'How do I fix an LG F9 code?', a: 'Watch the element on bake — a good electric element glows bright red. Replace a dark/split element; on gas, replace an igniter that glows but won\'t light. If both look fine, test the oven temp sensor.' },
    ],
    related: [['lg-range-f3', 'LG Range F3'], ['oven-not-heating', 'Oven Not Heating'], ['whirlpool-range-f3e1', 'Whirlpool Oven F3E1'] ] },

  { family: 'lg', appliance: 'Range', code: 'F3', brand: 'LG', display: 'F3', alt: '',
    quick: "An LG F3 is an oven temperature sensor fault (the exact meaning varies by model — check your legend), where the sensor reads open or shorted and the oven can't regulate. It's usually a cheap sensor swap: the probe unclips inside the oven and unplugs behind the back panel. Ohm-test it to confirm — a cold sensor reads around 1080 ohms.",
    bench: "F3 is the temp sensor on most LG ranges — ohm it out (about 1080Ω cold) before you ever suspect the board.",
    parts: [
      { name: 'Oven temperature sensor (RTD)', diff: 'moderate', price: '$15–40', terms: 'lg oven temperature sensor rtd', note: 'A cold sensor reads ~1080Ω; open/shorted confirms it. Unclips inside the oven, unplugs behind the rear panel. Match your model.' },
      { name: 'Oven control board', diff: 'pro', price: '$90–250', terms: 'lg oven control board', note: 'Rare — only if a known-good sensor still throws F3. Confirm before buying.' },
    ],
    safe: ['Let the oven cool; check the sensor probe isn\'t touching the oven wall.', 'With power off, ohm-test the sensor (a cold RTD reads ~1080 ohms).', 'Check the sensor plug behind the rear panel is seated.'],
    risk: ['Temperature sensor replacement — moderate; cut power at the breaker (240V), unclip and unplug the sensor.'],
    pro: ['The 240V wiring, or an oven control board you\'re unsure of.'],
    worth: "Worth it — the sensor is $15–40 and 20 minutes versus $700+ for a new range.",
    faq: [
      { q: 'What does F3 mean on an LG oven or range?', a: 'An oven temperature sensor fault — the sensor reads open or shorted so the oven can\'t regulate temperature (exact meaning varies by model). Usually a cheap sensor replacement.' },
      { q: 'How do I fix an LG F3 code?', a: 'With power off, ohm-test the oven temp sensor — a cold RTD reads about 1080 ohms. Replace it if it\'s open, shorted, or out of spec; it unclips inside the oven.' },
    ],
    related: [['lg-range-f9', 'LG Range F9'], ['ge-range-f3', 'GE Range F3'], ['oven-not-heating', 'Oven Not Heating'] ] },

  { family: 'lg', appliance: 'Dishwasher', code: 'OE', brand: 'LG', display: 'OE', alt: '',
    quick: "An LG dishwasher OE is a drain error — the water didn't pump out. Start free: clean the filter/sump of food, check the drain hose for a kink or a high-loop clog, and confirm a newly-installed disposal's knockout plug was removed. If the drain path is clear and it still won't empty, the drain pump is the part.",
    bench: "OE on an LG dishwasher is the same drill as any drain code — filter, hose, knockout plug, then pump.",
    parts: [
      { free: true, name: 'No part — clean filter, hose & knockout plug', note: 'Clean the filter/sump, straighten the drain hose, and confirm a new disposal\'s knockout plug was punched out. Clears most OE codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–80', terms: 'lg dishwasher drain pump', note: 'If everything upstream is clear and it still won\'t drain. Buy for your exact model.' },
    ],
    safe: ['Remove the bottom rack and clean the filter/sump.', 'Check the drain hose for kinks and clogs at the high loop.', 'If a disposal was just installed, confirm the knockout plug was removed.'],
    risk: ['Drain pump replacement — moderate; cut power and shut the water off.'],
    pro: ['A leak reaching the wiring/control under the tub.'],
    worth: "Usually worth it — free checks fix many OE codes; a drain pump is $30–80 versus a new dishwasher.",
    faq: [
      { q: 'What does OE mean on an LG dishwasher?', a: 'A drain error — the dishwasher didn\'t pump the water out. Usually a clogged filter, kinked drain hose, or a disposal knockout plug left in; sometimes a failed drain pump.' },
      { q: 'How do I fix an LG dishwasher OE code?', a: 'Clean the filter and sump, straighten the drain hose, and check for a left-in disposal knockout plug. If it still won\'t drain, replace the drain pump.' },
    ],
    related: [['lg-dishwasher-ae', 'LG DW AE'], ['dishwasher-not-draining', 'Dishwasher Not Draining'], ['samsung-dishwasher-5c', 'Samsung DW 5C'] ] },

  { family: 'lg', appliance: 'Dishwasher', code: 'AE', brand: 'LG', display: 'AE', alt: '',
    quick: "An LG AE (aqua error) means the leak sensor detected water in the base pan and shut the dishwasher off to protect your floor. Often it's a small spill, condensation, or oversudsing rather than a real flood — dry the base and restart. If AE returns quickly, water is genuinely leaking into the base from a hose, the door gasket, or the sump; find and fix that.",
    bench: "AE is a base-pan leak trip — dry it out and watch whether it comes back before chasing a part.",
    parts: [
      { free: true, name: 'No part — dry the base & cut suds', note: 'Soak the water out of the base pan so the float drops, and cut back detergent/rinse-aid if it\'s sudsing. Clears a one-time AE.' },
      { name: 'Fix the leak source (hose / gasket / sump)', diff: 'moderate', price: '$15–70', terms: 'lg dishwasher door gasket drain hose', note: 'If AE returns fast, water is still entering the base — check the door gasket, hose clamps, and sump, then replace the failed part.' },
    ],
    safe: ['Turn it off and soak the water out of the base pan so the float drops.', 'Cut back detergent if it\'s oversudsing.', 'Restart — if AE clears and stays gone, it was a one-time spill.'],
    risk: ['Tracing and replacing a leaking gasket/hose — moderate; power and water off.'],
    pro: ['A leak you can\'t locate, or water reaching the wiring/control.'],
    worth: "Often free — AE is frequently a drained-pan reset. A real recurring leak means a $15–70 part.",
    faq: [
      { q: 'What does AE mean on an LG dishwasher?', a: 'An aqua/leak error — the leak sensor found water in the base pan and shut the unit off. Often a small spill or oversudsing; sometimes a real leak from a hose, gasket, or the sump.' },
      { q: 'How do I fix an LG AE code?', a: 'Soak the water out of the base pan so the float drops and cut back detergent. If AE comes right back, find and fix the leaking hose, door gasket, or sump.' },
    ],
    related: [['lg-dishwasher-oe', 'LG DW OE'], ['bosch-dishwasher-e15', 'Bosch DW E15'], ['ge-dishwasher-c4', 'GE DW C4'] ] },

  // ── Whirlpool / Maytag ──────────────────────────────────────────────────────
  { family: 'whirlpool', appliance: 'Washer', code: 'F8E1', brand: 'Whirlpool', display: 'F8E1', alt: 'LF',
    quick: "A Whirlpool F8E1 (shown as LF, \"long fill\") means the washer isn't getting enough water fast enough. Like most fill faults it's usually the boring free stuff — a partly-closed faucet, a kinked or frozen hose, or clogged inlet screens — not a broken part. Rule those out first; the water inlet valve is the part only when water's flowing and the screens are clear.",
    bench: "Both faucets full-on, then rinse the mesh inlet screens where the hoses meet the machine — that's the free F8E1 fix.",
    parts: [
      { free: true, name: 'No part — open valves & clear screens', note: 'Both hot and cold faucets fully open, hoses unkinked/unfrozen, and the mesh inlet screens rinsed clear. Handles most F8E1 codes.' },
      { name: 'Water inlet valve', diff: 'moderate', price: '$25–55', terms: 'whirlpool washer water inlet valve', note: 'Only if water\'s on and screens are clear but it still fills too slowly. Match your model.' },
    ],
    safe: ['Open both supply faucets fully.', 'Straighten the fill hoses; in winter check for freezing.', 'Rinse the mesh inlet screens where the hoses meet the washer.'],
    risk: ['Water inlet valve swap — moderate; power off, water off.'],
    pro: ['A wiring fault to the valve, or a pressure-sensor/board issue.'],
    worth: "Cheap — free checks clear most F8E1 codes; the valve is $25–55.",
    faq: [
      { q: 'What does F8E1 or LF mean on a Whirlpool washer?', a: 'Long fill / low water — the washer isn\'t filling fast enough. Usually a partly-closed faucet, kinked/frozen hose, or clogged inlet screens; sometimes the inlet valve.' },
      { q: 'How do I fix a Whirlpool F8E1 (LF) code?', a: 'Open both faucets fully, straighten the hoses, and rinse the mesh inlet screens. If water is flowing and screens are clear but it still fills slowly, replace the water inlet valve.' },
    ],
    related: [['samsung-washer-4c', 'Samsung Washer 4C'], ['lg-washer-ie', 'LG Washer IE'], ['whirlpool-washer-ld', 'Whirlpool Washer LD'] ] },

  { family: 'whirlpool', appliance: 'Washer', code: 'SD', brand: 'Whirlpool', display: 'SD', alt: 'Sud',
    quick: "SD (or Sud) on a Whirlpool washer isn't a fault — it detected too many suds and paused to let them settle, extending the rinse. It's caused by too much detergent or non-HE soap in an HE machine. Run a rinse/spin to clear the foam and cut way back on soap. Free fix. A clogged drain filter can trap suds too — clean it if SD keeps returning.",
    bench: "SD is a soap message — 1 to 2 teaspoons of HE detergent, not a capful. That's the whole fix most of the time.",
    parts: [
      { free: true, name: 'No part — less HE detergent + rinse', note: 'Run a rinse/spin to clear the foam, then use only 1–2 teaspoons of HE detergent. Non-HE soap oversuds badly in HE machines.' },
      { free: true, name: 'Also check the drain filter', note: 'A clogged pump filter/coin trap can trap suds and re-trigger SD. Clean it (towel down).' },
    ],
    safe: ['Run a rinse/spin cycle to clear the suds.', 'Switch to HE detergent and use only 1–2 teaspoons.', 'Clean the drain-pump filter if SD keeps returning.'],
    risk: ['None — a detergent/cleaning fix, no parts.'],
    pro: ['Rarely needed — only if SD persists with correct HE detergent and a clean filter.'],
    worth: "Free — it\'s a detergent message. The only cost is the right soap and less of it.",
    faq: [
      { q: 'What does SD or Sud mean on a Whirlpool washer?', a: 'Too many suds — the washer paused to let the foam settle. Caused by too much detergent or non-HE soap in an HE machine, not a fault.' },
      { q: 'How do I clear a Whirlpool SD code?', a: 'Run a rinse/spin to clear the foam, then use only 1–2 teaspoons of HE detergent. If it keeps happening, clean the drain-pump filter.' },
    ],
    related: [['samsung-washer-sud', 'Samsung Washer SUD'], ['whirlpool-washer-ld', 'Whirlpool Washer LD'], ['washer-not-draining', 'Washer Not Draining'] ] },

  { family: 'whirlpool', appliance: 'Dryer', code: 'PF', brand: 'Whirlpool', display: 'PF', alt: '',
    quick: "A Whirlpool PF means \"power failure\" — the dryer lost power partway through a cycle. Most of the time it's harmless: just press Start to resume, and it clears. If PF keeps showing up, you've got a flaky power connection — a loose or damaged 240V cord, a worn outlet, or one half of the double breaker tripping. That's the part worth checking; the dryer itself is usually fine.",
    bench: "PF by itself is just \"you lost power\" — press start. If it repeats, the cord/outlet/breaker connection is loose, not the dryer.",
    parts: [
      { free: true, name: 'No part — press Start to resume / reset', note: 'A one-time PF just means power blipped mid-cycle. Press Start to resume. Reset the double 240V breaker fully off then on if needed.' },
      { name: 'Power cord (if damaged) / check the outlet', diff: 'moderate', price: '$15–35', terms: 'dryer power cord 240v 4 prong', note: 'If PF repeats, inspect the cord and outlet for burn/looseness. Replace a burnt cord; a worn outlet is an electrician job.' },
    ],
    safe: ['Press Start to resume the cycle after a one-time PF.', 'Reset the double 240V breaker fully off, then on.', 'Check the cord is firmly seated and the outlet isn\'t loose or scorched.'],
    risk: ['Replacing a burnt power cord — moderate; UNPLUG first (240V).'],
    pro: ['A worn/scorched outlet or house wiring — call an electrician.', 'A control board that keeps dropping power.'],
    worth: "Usually free — PF is just a power blip. Only a damaged cord ($15–35) or a worn outlet costs anything, and neither is a new dryer.",
    faq: [
      { q: 'What does PF mean on a Whirlpool dryer?', a: 'Power failure — the dryer lost power during the cycle. A one-time PF is harmless; press Start to resume. Repeated PF points to a loose/damaged cord, a worn outlet, or a tripping breaker.' },
      { q: 'How do I fix a repeating Whirlpool PF code?', a: 'Reset the double 240V breaker, then check the power cord and outlet for looseness or scorching. Replace a burnt cord; have an electrician handle a worn outlet or house wiring.' },
    ],
    related: [['whirlpool-dryer-f22', 'Whirlpool Dryer F22'], ['dryer-wont-start', "Dryer Won't Start"], ['whirlpool-dryer-af', 'Whirlpool Dryer AF'] ] },

  { family: 'whirlpool', appliance: 'Range', code: 'F2E1', brand: 'Whirlpool', display: 'F2E1', alt: 'F2 E1',
    quick: "A Whirlpool F2E1 means a stuck or shorted key on the oven touchpad — the control thinks a button is being held down. Sometimes a power reset (flip the breaker for a minute) clears a one-time glitch. If it comes right back, the touchpad membrane (or the control board it connects to) has failed and needs replacing. It's an electronics fix, not a heating part.",
    bench: "F2E1 is a stuck touchpad key — try a breaker reset first; if it returns, it's the membrane/control, not the oven itself.",
    parts: [
      { free: true, name: 'No part — power reset', note: 'Flip the oven\'s breaker off for a minute, then on, to clear a one-time stuck-key glitch.' },
      { name: 'Touchpad / membrane switch', diff: 'moderate', price: '$40–130', terms: 'whirlpool oven touchpad membrane switch', note: 'If F2E1 returns after a reset, the touchpad has a stuck key. Some models sell the touchpad separately; others as a clock/control combo. Match your model.' },
      { name: 'Oven control board (clock/ERC)', diff: 'pro', price: '$90–250', terms: 'whirlpool oven control board clock', note: 'If the touchpad is integrated with the control, or a new touchpad doesn\'t clear it. Confirm before buying.' },
    ],
    safe: ['Flip the oven\'s breaker off for a minute, then on, to try to clear it.', 'Look for a physically stuck or sticky button on the touchpad.', 'Confirm it\'s not just a locked/child-lock or timer mode.'],
    risk: ['Touchpad/membrane replacement — moderate; cut power at the breaker (240V), peel and reconnect the ribbon.'],
    pro: ['An integrated control board, or wiring you\'re unsure of.'],
    worth: "Worth it if it\'s a separate touchpad ($40–130). If the touchpad is fused to a pricey control board on an older range, weigh it against replacing.",
    faq: [
      { q: 'What does F2E1 mean on a Whirlpool oven?', a: 'A stuck or shorted key on the oven touchpad — the control reads a button as held down. Sometimes a power reset clears it; if not, the touchpad membrane or control board needs replacing.' },
      { q: 'How do I fix a Whirlpool F2E1 code?', a: 'Flip the oven breaker off for a minute and back on to clear a one-time glitch. If F2E1 returns, replace the touchpad/membrane switch (or the control board it\'s integrated with).' },
    ],
    related: [['whirlpool-range-f3e1', 'Whirlpool Oven F3E1'], ['ge-range-f2', 'GE Range F2'], ['oven-not-heating', 'Oven Not Heating'] ] },

  // ── Frigidaire / Electrolux ─────────────────────────────────────────────────
  { family: 'frigidaire', appliance: 'Refrigerator', code: 'H1', brand: 'Frigidaire', display: 'H1', alt: 'H',
    quick: "A Frigidaire H1 is a high-temperature alarm — the fridge or freezer got warmer than it should. It's a warning, not a broken part by itself, and sometimes it's nothing: a door left ajar, a big warm grocery load, or recovery after a power outage will trip it and it clears on its own. If it stays warm, work the cooling checklist: clean the condenser coils, confirm the fans run, and check the defrost system.",
    bench: "H1 is a symptom, not a part — if the doors were shut and it's still warm after a few hours, treat it like any 'fridge not cooling' and start with the coils.",
    parts: [
      { free: true, name: 'No part — check doors, coils & airflow', note: 'Make sure a door wasn\'t left ajar and the fridge isn\'t recovering from an outage or a big warm load. Vacuum the condenser coils and confirm vents inside aren\'t blocked. Often the whole fix.' },
      { name: 'Evaporator / condenser fan or defrost part', diff: 'moderate', price: '$25–80', terms: 'frigidaire refrigerator evaporator fan motor defrost kit', note: 'If it stays warm: a dead fan or a defrost failure is the usual cause. Diagnose which (frost on the coil points to defrost) and replace that part.' },
    ],
    safe: ['Confirm the doors seal and none were left ajar.', 'Give it a few hours to recover after an outage or a big warm load.', 'Vacuum the condenser coils (back or underneath) and check interior vents aren\'t blocked.'],
    risk: ['Evaporator/condenser fan or defrost-part replacement — moderate; unplug, remove a panel, let ice melt.'],
    pro: ['A silent compressor or a refrigerant leak (sealed system).'],
    worth: "Often free (a door or an outage). If it\'s a fan or defrost part it\'s $25–80 — still far under a new fridge. A sealed-system failure on an old unit is the exception.",
    faq: [
      { q: 'What does H1 mean on a Frigidaire refrigerator?', a: 'A high-temperature alarm — the fridge or freezer got too warm. Sometimes just a door left open or recovery after an outage; if it stays warm, a cooling problem (coils, fan, or defrost).' },
      { q: 'How do I fix a Frigidaire H1 code?', a: 'Confirm the doors were shut and give it a few hours to recover. If it stays warm, vacuum the condenser coils, check the fans run, and inspect the defrost system for a frost-buried coil.' },
    ],
    related: [['frigidaire-refrigerator-sy-ef', 'Frigidaire Fridge SY EF'], ['refrigerator-not-cooling', 'Fridge Not Cooling'], ['freezer-not-freezing', 'Freezer Not Freezing'] ] },

  { family: 'frigidaire', appliance: 'Refrigerator', code: 'SY EF', brand: 'Frigidaire', display: 'SY EF', alt: 'SY CF',
    quick: "A Frigidaire SY EF is an evaporator fan circuit / communication error — the control isn't seeing the evaporator fan running right, usually because the fan is iced up, the fan motor failed, or a connector came loose. The freezer warms and cooling drops. Thaw it out and check the fan connector first; if the fan's still dead, replace the evaporator fan motor.",
    bench: "SY EF is the evap fan or its wiring — thaw any frost, reseat the fan connector, then replace the motor if it's still dead.",
    parts: [
      { free: true, name: 'No part — thaw & reseat the fan connector', note: 'Force-defrost or unplug 24–48h to melt frost jamming the fan, and reseat the fan\'s wiring connector. Clears many SY EF codes.' },
      { name: 'Evaporator fan motor', diff: 'moderate', price: '$30–80', terms: 'frigidaire refrigerator evaporator fan motor', note: 'If the fan\'s still dead or noisy after thawing and reseating. Behind the freezer back panel. Match your model.' },
    ],
    safe: ['Listen at the freezer back panel for a dead or grinding fan.', 'Force-defrost or unplug 24–48h to melt frost jamming the fan.', 'Reseat the fan\'s wiring connector if you can reach it.'],
    risk: ['Evaporator fan motor replacement — moderate; unplug, remove the back panel, melt ice first.'],
    pro: ['A control-board communication fault, or a wiring harness issue you can\'t trace.'],
    worth: "Worth it — a fan motor is $30–80; nowhere near a new fridge.",
    faq: [
      { q: 'What does SY EF mean on a Frigidaire refrigerator?', a: 'An evaporator fan circuit / communication error — the control isn\'t seeing the evap fan run right, usually iced up, a failed fan motor, or a loose connector.' },
      { q: 'How do I fix a Frigidaire SY EF code?', a: 'Force a defrost or unplug 24–48 hours to melt frost jamming the fan, and reseat the fan connector. If the fan is still dead, replace the evaporator fan motor.' },
    ],
    related: [['frigidaire-refrigerator-h1', 'Frigidaire Fridge H1'], ['samsung-refrigerator-22c', 'Samsung Fridge 22C'], ['refrigerator-not-cooling', 'Fridge Not Cooling'] ] },

  { family: 'frigidaire', appliance: 'Dishwasher', code: 'I40', brand: 'Frigidaire', display: 'i40', alt: 'iF0',
    quick: "A Frigidaire i40 means a clogged filter/sump or a drain restriction — water isn't moving through the drain path the way it should. It's mostly a free fix: pull and rinse the filter, clear the sump, and check the drain hose for a kink or a disposal knockout plug. A drain pump is the part only if the whole path is clear and it still won't drain.",
    bench: "i40 is a restriction code — 90% of them clear by rinsing the filter and clearing the sump.",
    parts: [
      { free: true, name: 'No part — clean filter, sump & hose', note: 'Rinse the filter, scoop the sump, straighten the drain hose, and confirm a new disposal\'s knockout plug was removed. Clears most i40 codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–80', terms: 'frigidaire dishwasher drain pump', note: 'If the filter, sump, and hose are clear but it still won\'t drain. Match your model.' },
    ],
    safe: ['Remove the bottom rack, rinse the filter, and scoop the sump.', 'Check the drain hose for kinks and clogs.', 'Confirm a newly-installed disposal\'s knockout plug was removed.'],
    risk: ['Drain pump replacement — moderate; cut power and shut the water off.'],
    pro: ['A leak reaching the wiring/control under the tub.'],
    worth: "Usually free — i40 is a restriction. Only a drain pump ($30–80) is a real spend, still under a new dishwasher.",
    faq: [
      { q: 'What does i40 mean on a Frigidaire dishwasher?', a: 'A clogged filter/sump or drain restriction — water isn\'t moving through the drain path. Mostly a free fix; a failed drain pump only if the path is clear and it still won\'t drain.' },
      { q: 'How do I fix a Frigidaire i40 code?', a: 'Rinse the filter, clear the sump, and check the drain hose for kinks and a disposal knockout plug. If it still won\'t drain, replace the drain pump.' },
    ],
    related: [['frigidaire-dishwasher-i20', 'Frigidaire DW i20'], ['dishwasher-not-draining', 'Dishwasher Not Draining'], ['bosch-dishwasher-e22', 'Bosch DW E22'] ] },

  // ── Bosch ────────────────────────────────────────────────────────────────────
  { family: 'bosch', appliance: 'Dishwasher', code: 'E22', brand: 'Bosch', display: 'E22', alt: 'E-22',
    quick: "A Bosch E22 is a filter / drainage fault — the filter or drain path is blocked and water isn't clearing. Start free: remove and rinse the filter, and check the pump area for debris jamming the impeller. Then the drain hose and disposal connection. A drain pump is the part only if everything upstream is clean.",
    bench: "Pull the Bosch filter and check the impeller for a shard of glass or a toothpick — a jammed impeller is a common E22 that costs nothing.",
    parts: [
      { free: true, name: 'No part — clean the filter & pump area', note: 'Remove and rinse the filter, and clear the pump impeller of debris/glass. Check the drain hose for kinks. Clears many E22 codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–80', terms: 'bosch dishwasher drain pump', note: 'If the filter, impeller, and hose are clear but it still won\'t drain. Match your model.' },
    ],
    safe: ['Remove and rinse the filter; check the pump impeller for lodged debris.', 'Check the drain hose for kinks and clogs at the high loop and disposal.', 'Confirm a newly-installed disposal\'s knockout plug was removed.'],
    risk: ['Drain pump replacement — moderate; power and water off.'],
    pro: ['A leak reaching the wiring, or a control fault.'],
    worth: "Usually worth it — free checks fix many E22 codes; a drain pump is $30–80 versus a new Bosch.",
    faq: [
      { q: 'What does E22 mean on a Bosch dishwasher?', a: 'A filter/drainage fault — the filter or drain path is blocked. Usually a clogged filter or debris jamming the pump impeller; sometimes a failed drain pump.' },
      { q: 'How do I fix a Bosch E22 code?', a: 'Remove and rinse the filter and clear the pump impeller of debris, then check the drain hose. If it still won\'t drain, replace the drain pump.' },
    ],
    related: [['bosch-dishwasher-e24', 'Bosch DW E24'], ['bosch-dishwasher-e15', 'Bosch DW E15'], ['dishwasher-not-draining', 'Dishwasher Not Draining'] ] },

  // ── GE ───────────────────────────────────────────────────────────────────────
  { family: 'ge', appliance: 'Dishwasher', code: 'C1', brand: 'GE', display: 'C1', alt: '',
    quick: "A GE C1 means slow or no drain — the dishwasher isn't clearing the water in the expected time. Start free: clean the filter/sump of food, check the drain hose for a kink or a high-loop clog, and confirm a newly-installed disposal's knockout plug was removed. If the path is clear and it still drains slowly, the drain pump is the part.",
    bench: "C1 is GE's slow-drain code — filter, hose, knockout plug, then pump, in that order.",
    parts: [
      { free: true, name: 'No part — clean filter, hose & knockout plug', note: 'Clean the filter/sump, straighten the drain hose, and confirm a new disposal\'s knockout plug was removed. Clears most C1 codes.' },
      { name: 'Drain pump', diff: 'moderate', price: '$30–80', terms: 'ge dishwasher drain pump', note: 'If everything upstream is clear and it still drains slowly. Buy for your exact model.' },
    ],
    safe: ['Remove the bottom rack and clean the filter/sump.', 'Check the drain hose for kinks and clogs at the high loop.', 'If a disposal was just installed, confirm the knockout plug was removed.'],
    risk: ['Drain pump replacement — moderate; cut power and shut the water off.'],
    pro: ['A leak reaching the wiring/control under the tub.'],
    worth: "Usually worth it — the top causes are free and a drain pump is $30–80 versus a new dishwasher.",
    faq: [
      { q: 'What does C1 mean on a GE dishwasher?', a: 'Slow or no drain — the dishwasher isn\'t clearing water in time. Usually a clogged filter, kinked drain hose, or a disposal knockout plug left in; sometimes a failed drain pump.' },
      { q: 'How do I fix a GE C1 code?', a: 'Clean the filter and sump, straighten the drain hose, and check for a left-in disposal knockout plug. If it still drains slowly, replace the drain pump.' },
    ],
    related: [['ge-dishwasher-c4', 'GE DW C4'], ['dishwasher-not-draining', 'Dishwasher Not Draining'], ['frigidaire-dishwasher-i20', 'Frigidaire DW i20'] ] },

  { family: 'ge', appliance: 'Range', code: 'F2', brand: 'GE', display: 'F2', alt: '',
    quick: "A GE F2 is an oven over-temperature fault — the control read the oven hotter than it should get and shut the heat down as a safety. Usually the oven temperature sensor is reading wrong (drifting low-resistance makes the control overdrive the heat), or a relay on the control board stuck closed. Ohm-test the sensor first; if it's in spec, suspect the board. Don't ignore an over-temp code.",
    bench: "F2 is a safety over-temp — most often the temp sensor reading wrong, sometimes a welded relay on the board. Ohm the sensor before the board.",
    parts: [
      { name: 'Oven temperature sensor (RTD)', diff: 'moderate', price: '$15–40', terms: 'ge oven temperature sensor rtd', note: 'A cold sensor reads ~1080Ω; out-of-spec can cause an over-temp reading. Unclips inside the oven. Match your model.' },
      { name: 'Oven control board (relay stuck)', diff: 'pro', price: '$90–250', terms: 'ge oven control board', note: 'If the sensor checks out, a stuck bake/broil relay on the board can overdrive the heat. Confirm before buying.' },
    ],
    safe: ['Turn the oven off at the breaker until you\'ve checked it — an over-temp code is a safety flag.', 'With power off, ohm-test the oven temp sensor (a cold RTD reads ~1080 ohms).', 'Check the sensor probe isn\'t touching the oven wall.'],
    risk: ['Temperature sensor replacement — moderate; cut power at the breaker (240V), unclip and unplug the sensor.'],
    pro: ['A control board with a stuck relay, or any 240V wiring — an over-temp fault is worth a pro if the sensor is good.'],
    worth: "Worth it if it\'s the sensor ($15–40). If it\'s a stuck-relay control board on an older range, weigh the board price against replacing.",
    faq: [
      { q: 'What does F2 mean on a GE oven or range?', a: 'An oven over-temperature fault — the control sensed the oven too hot and shut the heat off for safety. Usually the temp sensor reading wrong; sometimes a stuck relay on the control board.' },
      { q: 'How do I fix a GE F2 code?', a: 'Turn the oven off at the breaker, then ohm-test the oven temp sensor (a cold RTD reads ~1080 ohms) and replace it if out of spec. If the sensor is good, a stuck relay on the control board is the likely cause — that\'s a pro repair.' },
    ],
    related: [['ge-range-f3', 'GE Range F3'], ['whirlpool-range-f2e1', 'Whirlpool Oven F2E1'], ['oven-not-heating', 'Oven Not Heating'] ] },

  // ── Wave 3 (2026-08-04): round out GE / Bosch / Whirlpool + high-intent gaps ──
  { family: 'whirlpool', appliance: 'Washer', code: 'F9E1', brand: 'Whirlpool', display: 'F9E1',
    quick: "F9E1 on a Whirlpool washer is a drain fault — the water didn't pump out in time. On the bench it's almost always a restriction, not a dead pump: a clogged pump filter, a kinked or too-high drain hose, or a sock/coin jamming the impeller. Clear those (free) before buying a pump.",
    bench: "Pull the drain-pump filter/trap at the bottom-front first — towel down, water spills — that clears most F9E1s.",
    parts: [
      { free: true, name: 'No part — clear the filter & drain path', note: "Clean the pump filter/trap, straighten the drain hose, and make sure it isn't pushed more than ~4 ft up the standpipe. Check the impeller for a coin or sock." },
      { name: 'Drain pump', diff: 'moderate', price: '$30–75', terms: 'whirlpool washer drain pump', note: "Only if the filter and hose are clear but the pump just hums or is silent on drain. Match your exact model number." },
    ],
    safe: ["Clean the pump filter/trap at the bottom-front (towel + shallow pan — water will pour out).", "Straighten the drain hose and confirm it isn't clogged or pushed too far up the standpipe.", "Reach in and clear the pump impeller of coins, socks, or lint."],
    risk: ["Drain pump replacement — power off and water shut off; expect leftover water in the tub."],
    pro: ["Water reaching the control board, or a wiring fault to the pump you can't trace."],
    worth: "Very worth it — the filter clean is free and clears most F9E1s; a pump is $30–75 and about an hour versus a new washer.",
    faq: [
      { q: 'What does F9E1 mean on a Whirlpool washer?', a: "A long-drain fault — the water didn't pump out in time. Usually a clogged pump filter, a kinked/too-high drain hose, or debris jamming the pump, not a failed pump." },
      { q: 'How do I fix a Whirlpool F9E1 code?', a: "Clean the drain-pump filter at the bottom-front, straighten the drain hose (keep it under ~4 ft up), and clear the impeller of coins or socks. If it still won't drain with a clear path, replace the drain pump." },
      { q: 'Where is the drain filter on a Whirlpool washer?', a: "On most front-loaders it's behind a small access panel at the bottom-front. Keep a towel and pan ready — water will come out when you open it." },
    ],
    related: [['whirlpool-washer-f8e1', 'Whirlpool Washer F8E1'], ['washer-not-draining', 'Washer Not Draining'], ['samsung-washer-5c', 'Samsung Washer 5C'] ] },

  { family: 'whirlpool', appliance: 'Dryer', code: 'L2', brand: 'Whirlpool', display: 'L2',
    quick: "L2 on a Whirlpool dryer means low or no line voltage — one of the two 120V legs of the 240V supply is missing, so the drum may turn but it won't heat. This is an ELECTRICAL supply problem, not a part inside the dryer: a half-tripped breaker, a burned outlet or power cord, or house wiring. Reset the breaker fully; if L2 returns, it's an outlet/wiring job for an electrician — 240V is dangerous.",
    bench: "Trip the dryer's double breaker fully OFF, then back ON — a double-pole breaker can trip one half and still look 'on.' If L2 returns, stop and get the outlet/wiring checked.",
    parts: [
      { free: true, name: 'No part — reset the double-pole breaker', note: "Flip the dryer's breaker completely off (both halves) then on. One tripped leg gives exactly this fault while the dryer still seems to power up." },
      { name: 'Power cord', diff: 'moderate', price: '$20–35', terms: 'whirlpool dryer power cord 4 prong', note: "Only if the cord is visibly burned or loose at the terminal block. Power OFF at the breaker first." },
    ],
    safe: ["Reset the dryer's double-pole breaker fully off, then on.", "With the breaker OFF, check the cord where it bolts to the dryer's terminal block for burn marks or a loose screw."],
    risk: ["Replacing a visibly burned power cord — only with the breaker OFF and confirmed dead."],
    pro: ["A burned or backed-out 240V outlet, or house wiring dropping a leg — call a licensed electrician. 240V wiring is not a DIY guess."],
    worth: "Often free (a reset) or a $20 cord. But if it's the outlet or wiring, pay the electrician — this is the one dryer code where the danger is in the wall, not the dryer.",
    faq: [
      { q: 'What does L2 mean on a Whirlpool dryer?', a: "Low or no line voltage — one of the two 120V legs feeding the 240V outlet is missing, so the dryer won't heat properly. It's a supply/wiring issue, not a part inside the dryer." },
      { q: 'Why does my Whirlpool dryer run but not heat with an L2 code?', a: "Heat needs the full 240V (both legs). If one leg drops from a half-tripped breaker or a burned outlet, the motor (120V) still runs but the heater (240V) can't — that's L2." },
      { q: 'Is an L2 code safe to fix myself?', a: "Resetting the breaker is fine. But a burned outlet or house wiring dropping a leg is a job for a licensed electrician — 240V can seriously injure you. Don't guess at the wiring." },
    ],
    related: [['whirlpool-dryer-af', 'Whirlpool Dryer AF'], ['dryer-not-heating', 'Dryer Not Heating'], ['dryer-wont-start', "Dryer Won't Start"] ] },

  { family: 'whirlpool', appliance: 'Washer', code: 'F7E1', brand: 'Whirlpool', display: 'F7E1',
    quick: "F7E1 on a Whirlpool washer is a motor speed/drive fault — the control commanded the motor but didn't get the speed it expected. First rule out the free stuff: a badly overloaded or jammed tub, or (on belt models) a slipping/broken belt. If the tub spins freely and it still throws F7E1, the drive motor or the rotor position sensor is the suspect.",
    bench: "Spin the empty tub by hand — if it drags or a sock is wedged under the basket, that alone can throw F7E1.",
    parts: [
      { free: true, name: 'No part — clear the tub & check the load', note: "Remove any overload, check for a garment jammed between tub and basket, and (belt-drive models) look for a broken/slipped belt." },
      { name: 'Rotor position sensor', diff: 'moderate', price: '$20–45', terms: 'whirlpool washer rotor position sensor', note: "A common F7E1 cause on direct-drive models — cheaper to try before the motor. Match your model." },
      { name: 'Drive motor', diff: 'pro', price: '$120–260', terms: 'whirlpool washer drive motor', note: "If the sensor is good and the motor won't drive to speed. A bigger job — verify with the position sensor first." },
    ],
    safe: ["Remove any overload and check for a garment jammed between the basket and tub.", "Spin the empty tub by hand to feel for drag or an obstruction."],
    risk: ["Rotor position sensor swap — power off; it's behind the rotor on direct-drive models."],
    pro: ["Drive motor replacement or a control-board fault — a bigger teardown best left to a tech."],
    worth: "Worth checking — the free tub/load check clears some F7E1s, and the position sensor is a cheap first part. Only the drive-motor path gets expensive, so diagnose before you buy.",
    faq: [
      { q: 'What does F7E1 mean on a Whirlpool washer?', a: "A motor speed/drive fault — the control didn't see the motor reach the speed it commanded. Often an overload or jammed tub; sometimes the rotor position sensor or drive motor." },
      { q: 'Can I fix a Whirlpool F7E1 myself?', a: "Start free: clear any overload and spin the empty tub to check for drag. If it's clear, the rotor position sensor is a cheap DIY part to try before the drive motor." },
      { q: 'Is F7E1 expensive to fix?', a: "Not usually — most are a load/obstruction (free) or a $20–45 position sensor. Only a full drive-motor replacement runs higher." },
    ],
    related: [['whirlpool-washer-f8e1', 'Whirlpool Washer F8E1'], ['washer-not-spinning', 'Washer Not Spinning'], ['whirlpool-washer-ld', 'Whirlpool Washer LD'] ] },

  { family: 'ge', appliance: 'Range', code: 'F9', brand: 'GE', display: 'F9',
    quick: "F9 on a GE range is a door-lock/latch fault — the control tried to run the oven door latch (usually around a self-clean cycle) and didn't get the switch feedback it expected. Most F9s show up after a self-clean when the motorized latch sticks. Try cycling the latch first; if it won't lock/unlock on command, the latch assembly is the part.",
    bench: "If F9 hit right after a self-clean, let the oven fully cool, then start and cancel a short self-clean to drive the latch through its travel — it often frees a stuck latch.",
    parts: [
      { free: true, name: 'No part — cycle the latch / cool-down reset', note: "Let the oven cool completely, then run and cancel a self-clean so the latch motor drives fully open. Power-cycle at the breaker for 60 seconds." },
      { name: 'Oven door latch assembly', diff: 'moderate', price: '$40–95', terms: 'ge oven door latch assembly', note: "If the latch won't drive open/closed or the switches don't read. Usually accessed from the top or rear of the range." },
    ],
    safe: ["Let the oven cool fully, then start and cancel a self-clean to cycle the latch.", "Power-cycle the range at the breaker for a minute."],
    risk: ["Door latch assembly replacement — power off at the breaker; the motorized latch sits above/behind the oven cavity."],
    pro: ["Latch wiring or a control-board fault you can't trace."],
    worth: "Worth it — many F9s clear for free by cycling the latch after a self-clean, and the latch part is $40–95 versus a new range.",
    faq: [
      { q: 'What does F9 mean on a GE oven?', a: "A door-lock/latch fault — the oven's motorized latch didn't report the position the control expected, often after a self-clean cycle." },
      { q: 'How do I clear a GE F9 code?', a: "Let the oven cool, then start and cancel a self-clean cycle to drive the latch through its full travel, and power-cycle at the breaker. If the latch still won't lock/unlock, replace the door latch assembly." },
      { q: 'Why did F9 appear after self-cleaning?', a: "The high-heat self-clean cycle locks the door with a motorized latch; if that latch sticks or a switch stops reading, you get F9. Cycling it once cool usually frees it." },
    ],
    related: [['ge-range-f2', 'GE Range F2'], ['ge-range-f7', 'GE Range F7'], ['oven-not-heating', 'Oven Not Heating'] ] },

  { family: 'ge', appliance: 'Range', code: 'F7', brand: 'GE', display: 'F7',
    quick: "F7 on a GE range means a stuck button or a shorted membrane (touchpad) switch — the control keeps 'seeing' a key pressed. Sometimes a single sticky button; often the membrane/control panel has failed. The clean test: disconnect the touchpad ribbon from the control — if F7 clears, the panel is bad.",
    bench: "Press every button firmly one at a time to pop a stuck key; if F7 won't clear, the membrane/touchpad is the usual replacement.",
    parts: [
      { free: true, name: 'No part — free a stuck key', note: "Press each button firmly to unstick it, and power-cycle at the breaker for a minute. Occasionally a physically stuck key is all it is." },
      { name: 'Touchpad / control panel (membrane)', diff: 'moderate', price: '$60–180', terms: 'ge range touchpad control panel membrane', note: "If disconnecting the touchpad ribbon clears the fault, the membrane is bad — replace the touchpad or panel assembly. Match your exact model." },
    ],
    safe: ["Press each button firmly to free a physically stuck key.", "Power-cycle the range at the breaker for a minute."],
    risk: ["Touchpad/membrane replacement — power off; the ribbon connector and panel come off the console."],
    pro: ["A control-board fault (vs. the membrane) — if a new touchpad doesn't clear it."],
    worth: "Usually worth it — a stuck key is free to clear; a touchpad is $60–180. Only if it's the control board does it get pricier, so test by unplugging the ribbon first.",
    faq: [
      { q: 'What does F7 mean on a GE range?', a: "A stuck button or shorted membrane switch — the control is reading a key as constantly pressed. Sometimes one sticky button, often a failed touchpad/membrane." },
      { q: 'How do I fix a GE F7 code?', a: "Press each button to free a stuck key and power-cycle. If it persists, disconnect the touchpad ribbon from the control — if F7 clears, replace the touchpad/membrane panel." },
      { q: 'Is F7 dangerous?', a: "It won't hurt you, but a stuck key can make the oven behave unpredictably, so it's worth fixing promptly rather than ignoring." },
    ],
    related: [['ge-range-f2', 'GE Range F2'], ['ge-range-f9', 'GE Range F9'], ['oven-not-heating', 'Oven Not Heating'] ] },

  { family: 'ge', appliance: 'Dishwasher', code: 'C2', brand: 'GE', display: 'C2',
    quick: "C2 on a GE dishwasher means it tried to drain and water is still there — the C1 drain fault repeating. It's almost always a blockage, not a dead pump: a clogged filter, food in the drain hose, a plugged air gap, or a new disposal with the knockout plug still in. Clear the whole drain path (free) before replacing anything.",
    bench: "If a garbage disposal was recently installed, check the knockout plug was removed — that single plug causes a lot of 'won't drain' calls.",
    parts: [
      { free: true, name: 'No part — clear the full drain path', note: "Clean the bottom filter, check the drain hose for kinks/clogs, clear the air gap on the counter, and confirm the disposal knockout plug is out." },
      { name: 'Drain pump', diff: 'moderate', price: '$40–110', terms: 'ge dishwasher drain pump', note: "Only if the entire drain path is clear but it still won't pump out. Match your exact model." },
    ],
    safe: ["Scoop standing water, then clean the bottom filter and sump.", "Check the drain hose under the sink for kinks and clogs; clear the counter air gap.", "If a disposal was just added, confirm the knockout plug was removed."],
    risk: ["Drain pump replacement — power and water off; some water remains in the sump."],
    pro: ["A leak or a control fault you can't trace after the drain path is verified clear."],
    worth: "Very worth it — the drain-path clean is free and fixes most C2s; a pump is $40–110 versus a new dishwasher.",
    faq: [
      { q: 'What does C2 mean on a GE dishwasher?', a: "A repeated drain fault (a C1 that didn't clear) — water isn't pumping out. Usually a clogged filter, drain hose, air gap, or a disposal knockout plug left in." },
      { q: 'How do I fix a GE C2 code?', a: "Clean the filter and sump, clear the drain hose and air gap, and make sure a new disposal's knockout plug was removed. If the whole path is clear and it still won't drain, replace the drain pump." },
      { q: 'Why does C2 keep coming back?', a: "The drain restriction is still there. Clear every part of the path — filter, hose, air gap, disposal inlet — not just one, or the code returns." },
    ],
    related: [['ge-dishwasher-c1', 'GE Dishwasher C1'], ['dishwasher-not-draining', 'Dishwasher Not Draining'], ['ge-dishwasher-c4', 'GE Dishwasher C4'] ] },

  { family: 'bosch', appliance: 'Dishwasher', code: 'E09', brand: 'Bosch', display: 'E09',
    quick: "E09 on a Bosch dishwasher is a heating fault — the flow-through heater built into the circulation/heat pump isn't heating the water. You'll usually notice dishes coming out cold and not drying. There's no free fix for this one: it's the heat pump/heating element or its wiring, and on Bosch that's an under-the-tub repair.",
    bench: "Confirm the symptom — cold water, poor drying — then check the heat-pump wiring/connector before condemning the pump; a loose or heat-damaged connector sometimes mimics E09.",
    parts: [
      { free: true, name: 'No part — check the heater connector', note: "Power off, tip the machine, and inspect the heat-pump connector for heat damage or a loose fit. Rarely the whole fix, but free to rule out." },
      { name: 'Heat pump / heating element', diff: 'pro', price: '$90–220', terms: 'bosch dishwasher heat pump heating element', note: "The usual E09 part — it's under the tub, so it's a bigger job. Match your exact model number." },
    ],
    safe: ["Confirm the symptom: cold water and dishes not drying.", "With power off, check the heat-pump connector for burn marks or looseness."],
    risk: ["Heat pump / element replacement — a hands-on under-the-tub job; comfortable DIYers only, power and water off."],
    pro: ["The heat-pump swap if you're not comfortable laying the machine over and pulling the sump — and any wiring fault you can't trace."],
    worth: "Borderline — the part is $90–220 but it's labor-heavy. Worth it on a newer Bosch you like; on an old unit, weigh it against replacement.",
    faq: [
      { q: 'What does E09 mean on a Bosch dishwasher?', a: "A heating fault — the flow-through heater in the circulation/heat pump isn't heating the water, so dishes come out cold and don't dry." },
      { q: 'Can I fix a Bosch E09 myself?', a: "It's an advanced repair — the heater is part of the heat pump under the tub. Check the connector first (free), but the part swap means tipping the machine and pulling the sump." },
      { q: "Why aren't my dishes drying with an E09 code?", a: "Bosch relies on hot water for its condensation drying. With E09 the water never heats, so both cleaning and drying suffer." },
    ],
    related: [['bosch-dishwasher-e15', 'Bosch Dishwasher E15'], ['dishwasher-not-cleaning', 'Dishwasher Not Cleaning'], ['bosch-dishwasher-e22', 'Bosch Dishwasher E22'] ] },

  { family: 'bosch', appliance: 'Dishwasher', code: 'E17', brand: 'Bosch', display: 'E17',
    quick: "E17 on a Bosch dishwasher means water is coming in too fast — the flow meter sees a higher inflow rate than expected. The common (free) cause is household water pressure that's too high, or the fill valve not regulating. Try throttling the supply valve slightly first; if that doesn't settle it, the inlet valve or flow meter is next.",
    bench: "Partially close the under-sink supply valve to knock the pressure down a touch, then re-run — that alone clears a lot of E17s on high-pressure homes.",
    parts: [
      { free: true, name: 'No part — throttle the supply pressure', note: "Partially close the dishwasher's supply shutoff under the sink to lower inflow, then run a cycle. High house pressure is the usual E17 trigger." },
      { name: 'Water inlet valve', diff: 'moderate', price: '$30–70', terms: 'bosch dishwasher water inlet valve', note: "If throttling doesn't help — the valve may not be regulating flow. Match your model." },
    ],
    safe: ["Partially close the supply shutoff under the sink to reduce inflow pressure, then re-run.", "Confirm the fill hose isn't kinked or restricted upstream."],
    risk: ["Inlet valve replacement — water off and power off; the valve is at the lower front/side."],
    pro: ["A flow-meter fault or control issue if a valve swap and pressure adjustment don't clear it."],
    worth: "Usually cheap — most E17s are a pressure adjustment (free) or a $30–70 inlet valve. No reason to replace the dishwasher over a fill-rate code.",
    faq: [
      { q: 'What does E17 mean on a Bosch dishwasher?', a: "Water is flowing in too fast — the flow meter reads a higher inflow rate than expected. Usually high household water pressure or an inlet valve not regulating." },
      { q: 'How do I fix a Bosch E17 code?', a: "Partially close the supply valve under the sink to lower the pressure and re-run. If it persists, replace the water inlet valve." },
      { q: 'Is E17 serious?', a: "Not usually — it's a fill-rate warning, often just high water pressure. Throttling the supply or swapping the inlet valve clears it." },
    ],
    related: [['bosch-dishwasher-e15', 'Bosch Dishwasher E15'], ['bosch-dishwasher-e24', 'Bosch Dishwasher E24'], ['dishwasher-not-draining', 'Dishwasher Not Draining'] ] },

  { family: 'lg', appliance: 'Dishwasher', code: 'LE', brand: 'LG', display: 'LE',
    quick: "LE on an LG dishwasher is a motor/circulation error — the wash motor drew the wrong current or stalled. First rule out a jam: a piece of glass, a bone, or debris caught in the impeller can stall the motor and throw LE. Clear the sump/filter; if the motor still won't run right, it's the wash motor (an advanced part).",
    bench: "Clear the filter and feel the sump for a shard of glass or a chip clip stuck in the impeller — a jam mimics a bad motor.",
    parts: [
      { free: true, name: 'No part — clear the sump & impeller', note: "Remove the bottom filter and clear any debris (glass, food, a wedged utensil) from the sump and wash-impeller area. A stall reads as LE." },
      { name: 'Wash / circulation motor', diff: 'pro', price: '$90–230', terms: 'lg dishwasher circulation wash motor', note: "If the sump is clear but the motor won't circulate — an under-tub repair. Match your exact model." },
    ],
    safe: ["Power off, pull the bottom filter, and clear the sump and impeller of any debris.", "Confirm nothing is jamming the spray-arm hub."],
    risk: ["Wash-motor replacement — an under-the-tub job; comfortable DIYers only, power and water off."],
    pro: ["The circulation-motor swap if you're not comfortable laying the unit over, plus any wiring fault."],
    worth: "Worth a look — the free sump/impeller clear fixes some LEs; the motor is $90–230 but labor-heavy. Weigh the motor repair against the dishwasher's age.",
    faq: [
      { q: 'What does LE mean on an LG dishwasher?', a: "A motor/circulation error — the wash motor stalled or drew abnormal current. Often a jam in the sump/impeller; sometimes a failed circulation motor." },
      { q: 'How do I fix an LG dishwasher LE code?', a: "Clear the filter and sump of debris (glass, food, utensils) that can jam the impeller and re-run. If it's clean and LE returns, the circulation motor likely needs replacing." },
      { q: 'Is LE the same as a leak code?', a: "No — on an LG dishwasher LE is a motor/circulation fault, not a leak. Don't confuse it with LG's leak/overflow errors." },
    ],
    related: [['lg-dishwasher-oe', 'LG Dishwasher OE'], ['dishwasher-not-cleaning', 'Dishwasher Not Cleaning'], ['lg-dishwasher-ae', 'LG Dishwasher AE'] ] },

  { family: 'samsung', appliance: 'Washer', code: 'UE', brand: 'Samsung', display: 'UE', alt: 'UB',
    quick: "UE (newer displays: UB) on a Samsung washer is an unbalanced-load error — the machine couldn't distribute the load evenly to spin. Nine times out of ten it's the load: a bulky item like a comforter, or a small heavy tangle on one side. Redistribute, and make sure the washer is level. Only a chronic UE on every load points to worn suspension.",
    bench: "Open it up, spread the load out (especially one heavy item), and check the machine is level and not rocking — that clears most UE codes on the spot.",
    parts: [
      { free: true, name: 'No part — redistribute & level the machine', note: "Spread the load evenly, wash bulky single items with a couple of towels, and level the washer so it doesn't rock. This clears the vast majority of UE/UB codes." },
      { name: 'Suspension rods / dampers', diff: 'moderate', price: '$25–70', terms: 'samsung washer suspension rod damper kit', note: "Only if UE happens on nearly every load and the tub bangs or drops — the shocks/rods are worn. Replace as a set." },
    ],
    safe: ["Pause, open the lid/door, and redistribute the load evenly.", "Wash a single bulky item (comforter, rug) with a couple of towels to balance it.", "Check the washer is level and the shipping bolts were removed."],
    risk: ["Suspension rod/damper replacement — a moderate job on the tub support; do the whole set."],
    pro: ["A tub or bearing problem if the drum is loose or noisy beyond the suspension."],
    worth: "Almost always free — it's a load-balance fix. Only a chronic UE needs suspension parts ($25–70), which still beats a new washer.",
    faq: [
      { q: 'What does UE mean on a Samsung washer?', a: "An unbalanced-load error — the washer couldn't balance the load to spin safely. Newer models show it as UB. Usually just the load; occasionally worn suspension." },
      { q: 'How do I fix a Samsung UE code?', a: "Open the washer, spread the load out (add a couple of towels to a bulky single item), and make sure the machine is level and not rocking. That clears most UE codes." },
      { q: 'Why does my Samsung washer keep saying UE every load?', a: "If it happens on every load even when balanced and level, the suspension rods/dampers are worn and let the tub swing — replace them as a set." },
    ],
    related: [['samsung-washer-ub', 'Samsung Washer UB'], ['washer-not-spinning', 'Washer Not Spinning'], ['lg-washer-ue', 'LG Washer UE'] ] },
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
