#!/usr/bin/env node
/* Appliance Ant — symptom/DIY page generator (applianceant.com, the consumer/DIY brand).
 *
 * Why this exists: applianceant.com is the nationwide DIY + parts site (Phase 3 of the
 * two-property split). Unlike the repair site (tnapplianceexchange.net) — which never shares
 * part numbers to avoid warranty/cash side-shopping — the WHOLE POINT here is to name the exact
 * part and hand the DIYer an Amazon link to buy it. That's the parts revenue rail.
 *
 * Lives OUTSIDE the applianceant/ publish folder on purpose (Netlify Base=applianceant,
 * publish=".") so build files never ship. It WRITES finished static HTML into applianceant/.
 *
 * Run:  node tools/applianceant-build/build-symptoms.js
 * Then commit the generated applianceant/*.html + updated sitemap.
 *
 * Amazon affiliate: set AMAZON_TAG below when Teddy has an Associates tag; it appends &tag=.
 * Empty = clean Amazon search links (work today, honest, no wrong SKUs). One-line change later.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'applianceant');
const AMAZON_TAG = ''; // e.g. 'applianceant-20' once the Associates account is approved
const REPAIR = 'https://tnapplianceexchange.net';

// ---- helpers ---------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amz = (terms) => {
  const q = encodeURIComponent(terms).replace(/%20/g, '+');
  return `https://www.amazon.com/s?k=${q}${AMAZON_TAG ? `&tag=${AMAZON_TAG}` : ''}`;
};
const DIFF = { easy: ['Easy DIY', '#39ff14'], moderate: ['Moderate DIY', '#ff9d28'], pro: ['Call a pro', '#ff3b30'] };

// ---- the data: 6 flagship symptoms, one per appliance type -----------------
const SYMPTOMS = [
  {
    slug: 'dryer-not-heating', appliance: 'Dryer', icon: '🔥',
    h1: 'Dryer Not Heating?', h1em: "Here's the Honest Fix.",
    title: 'Dryer Not Heating? The Real Cause + the Exact Part to Buy',
    desc: "Dryer tumbles but won't heat? It's almost always one of three cheap parts. Ant names the exact one, links you to it, and tells you when to call a pro instead.",
    keywords: 'dryer not heating, dryer no heat, dryer heating element, dryer thermal fuse, how to fix dryer not heating, dryer won\'t get hot',
    quick: "A dryer that tumbles but won't heat has power to the motor but not the heat circuit. On electric dryers it's usually a burned-out heating element or a blown thermal fuse; on gas, a weak igniter. The silent root cause is a clogged vent — clear it first, or the new part blows again.",
    causes: [
      { h3: 'Clogged vent or lint blockage', p: 'Heat needs somewhere to go. A packed or kinked vent line traps heat until a safety fuse pops. Clear the whole run to the outside flap first — it\'s free and it\'s the #1 repeat cause.', part: { name: 'Dryer vent cleaning kit', diff: 'easy', price: '$15–30', terms: 'dryer vent cleaning kit brush', note: 'A rod-and-brush kit clears the wall duct any element swap can\'t fix.' } },
      { h3: 'Blown thermal fuse', p: 'A one-shot safety device. Once it blows, no power reaches the heat circuit. Cheap and quick to swap — but fix the airflow that blew it or the new one goes too.', part: { name: 'Dryer thermal fuse', diff: 'moderate', price: '$8–20', terms: 'dryer thermal fuse', sku: 'Whirlpool/Kenmore 3392519 fits many 29" models', note: 'Confirm the part number against your model before buying.' } },
      { h3: 'Failed heating element (electric)', p: 'The metal coil that makes the heat burns through over time. This is the most common no-heat fix on electric dryers.', part: { name: 'Dryer heating element', diff: 'moderate', price: '$20–60', terms: 'dryer heating element', sku: 'Whirlpool 279838 fits many Whirlpool/Kenmore/Roper 29" dryers', note: 'Match to your exact model — same part name, many variants.' } },
      { h3: 'Bad thermostat / thermal cutoff', p: 'These regulate temperature. When they fail open the heat circuit stays off. They often fail alongside a thermal fuse from the same airflow root cause — many buy the kit.', part: { name: 'Dryer thermostat / cutoff kit', diff: 'moderate', price: '$12–35', terms: 'dryer thermostat thermal cutoff kit', note: 'Kits bundle the fuse + thermostats for the common failure.' } },
      { h3: 'Weak or failed gas igniter (gas dryers)', p: 'On gas dryers the igniter glows weak or won\'t light the burner. Different part entirely from electric — the model number tells us which path you\'re on.', part: { name: 'Dryer gas igniter', diff: 'pro', price: '$20–45', terms: 'dryer gas igniter', note: 'Gas work: if you\'re not confident with the gas valve, get a pro.' } },
    ],
    safe: ['Clean the full lint/vent run to the outside flap — the #1 root cause.', 'Check the breaker: electric dryers use a double 240V breaker; one half can trip and kill heat while the drum still turns. Flip it fully off, then on.', 'Confirm you\'re not on Air Fluff / No-Heat / Timed-Dry-cool.'],
    risk: ['Thermal fuse, heating element, or thermostat swap — all testable with a $10 multimeter and replaceable, but the cabinet comes apart and the dryer must be UNPLUGGED first.'],
    pro: ['Anything on a gas dryer — igniter, gas valve, or a gas smell.', 'The 240V cord, outlet, or internal wiring.', 'A control board not sending power to the element.'],
    worth: 'Almost always worth it. The common no-heat parts run $8–60 and 30–60 minutes of your time — versus $500+ for a new dryer. A well-built 10-year-old dryer with an available part is worth fixing twice. Only a newer machine with a discontinued control board is a real "maybe."',
    faq: [
      { q: 'Why is my dryer not heating but still running?', a: 'The motor circuit is fine but the heat circuit isn\'t getting power or has a broken part — usually a thermal fuse, heating element, or thermostat. A blocked vent is what blows the fuse in the first place.' },
      { q: 'What\'s the most common reason a dryer stops heating?', a: 'On electric dryers, a burned-out heating element or a thermal fuse blown by a clogged vent. Clear the vent, then test the fuse and element with a multimeter.' },
      { q: 'How much does it cost to fix a dryer that won\'t heat yourself?', a: 'The parts are cheap — $8–60 depending on which one failed. A thermal fuse is the low end; a heating element the middle. The bigger cost is a new dryer if you skip the fix.' },
      { q: 'Can I run my dryer with no heat?', a: 'You can, but it\'ll never fully dry and damp clothes in a barely-warm drum invite mildew. The underlying problem also tends to get worse.' },
    ],
    related: [['washer-not-draining', 'Washer Not Draining'], ['refrigerator-not-cooling', 'Fridge Not Cooling'], ['oven-not-heating', 'Oven Not Heating']],
  },
  {
    slug: 'washer-not-draining', appliance: 'Washer', icon: '🌀',
    h1: 'Washer Not Draining?', h1em: "Find the Clog or the Pump.",
    title: "Washer Not Draining? The Real Cause + the Exact Part",
    desc: "Washer won't drain and left standing water? It's usually a clogged pump filter or a failed drain pump. Ant tells you which, links the part, and where front-load and top-load differ.",
    keywords: 'washer not draining, washing machine won\'t drain, washer standing water, washer drain pump, clogged washer pump filter',
    quick: "Standing water almost always means the water can't get through the pump. On front-loaders it's very often the coin-trap filter packed with lint, coins, and socks — a free clean. If the pump hums but won't move water, or is silent, the drain pump itself has failed. Top-loaders add a lid switch that can stop the drain/spin.",
    causes: [
      { h3: 'Clogged pump filter / coin trap (front-load)', p: 'Front-loaders have a small access door at the bottom front hiding a filter. Lint, coins, and hairpins collect there and block the drain. Cleaning it is free and fixes a huge share of "won\'t drain" calls.', part: { name: 'No part — just clean it', diff: 'easy', price: 'Free', terms: 'front load washer drain pump filter', note: 'Lay a towel down first — a cup or two of water spills out.' } },
      { h3: 'Failed drain pump', p: 'If the filter\'s clear but the pump hums without moving water — or is dead silent — the drain pump has failed. This is the most common part replacement for this symptom.', part: { name: 'Washer drain pump', diff: 'moderate', price: '$25–70', terms: 'washer drain pump', note: 'Front-load and top-load pumps differ — buy the one for YOUR model number.' } },
      { h3: 'Clogged or kinked drain hose', p: 'The hose at the back can kink behind the machine or clog where it meets the standpipe. Pull the washer out and check the whole run.', part: { name: 'Washer drain hose', diff: 'easy', price: '$12–30', terms: 'washer drain hose', note: 'Only replace if it\'s split or crushed — otherwise just clear it.' } },
      { h3: 'Bad lid switch or door lock (top-load)', p: 'Many top-loaders won\'t spin or drain if the lid switch doesn\'t register "closed." A failed switch fakes an open lid and stops the drain.', part: { name: 'Washer lid switch / door lock', diff: 'moderate', price: '$15–45', terms: 'washer lid switch assembly', note: 'Front-loaders use a door-lock assembly instead — match your type.' } },
    ],
    safe: ['Clean the front-load pump filter (coin trap) — towel down first.', 'Pull the machine out and check the drain hose for kinks or clogs at the standpipe.', 'Run a drain/spin-only cycle to confirm the symptom before buying anything.'],
    risk: ['Drain pump or lid-switch replacement — very doable, but UNPLUG the washer and turn off the water first. Expect leftover water in the tub.'],
    pro: ['Any repair that means tipping the machine and you don\'t have help — front-loaders are heavy.', 'A leak you can\'t trace, or water reaching the motor/control board.'],
    worth: 'Very worth it. A pump filter clean is free; a drain pump is $25–70 and about an hour. A new washer is $600+. Unless the drum bearing is also gone (a loud repair), draining issues are among the most cost-effective DIY fixes there are.',
    faq: [
      { q: 'Why is my washer full of water and not draining?', a: 'The water can\'t get past the pump. Check the front-load pump filter first (free), then the drain hose, then the drain pump itself. Top-loaders can also stop draining on a bad lid switch.' },
      { q: 'Where is the drain pump filter on a front-load washer?', a: 'Behind a small access panel at the bottom front. Twist the cap counter-clockwise to open — keep a towel and shallow pan ready, water will come out.' },
      { q: 'Is a front-load drain pump the same as a top-load one?', a: 'No. They\'re different parts even within the same brand. Always buy the pump listed for your exact model number.' },
      { q: 'How do I know if my drain pump is bad?', a: 'If the filter and hose are clear but the pump buzzes without moving water, or makes no sound at all during the drain cycle, the pump has failed.' },
    ],
    related: [['dishwasher-not-draining', 'Dishwasher Not Draining'], ['dryer-not-heating', 'Dryer Not Heating'], ['refrigerator-not-cooling', 'Fridge Not Cooling']],
  },
  {
    slug: 'refrigerator-not-cooling', appliance: 'Refrigerator', icon: '🧊',
    h1: 'Fridge Not Cooling?', h1em: 'Start Cheap, Stay Safe.',
    title: 'Refrigerator Not Cooling? Real Causes + the Part to Buy (and When to Stop)',
    desc: "Fridge warm but running? Start with the free fixes (coils, airflow), then the evaporator fan or defrost parts. Ant tells you the exact part — and when it's a sealed-system job for a pro.",
    keywords: 'refrigerator not cooling, fridge warm not cold, refrigerator evaporator fan, refrigerator defrost, condenser coils dirty, fridge not cold enough',
    quick: "If the fridge is running but warm, work from cheapest to hardest: dirty condenser coils choke cooling and are free to clean; a dead evaporator fan stops cold air moving to the fridge section; a failed defrost part lets frost bury the coil. If the compressor is silent or the sealed system leaked refrigerant, that's a pro job — don't chase it.",
    causes: [
      { h3: 'Dirty condenser coils', p: 'Coils caked in dust can\'t shed heat, so the fridge runs and runs but never gets cold. Vacuum them (back or underneath) — free and often the whole fix.', part: { name: 'Coil cleaning brush', diff: 'easy', price: '$8–15', terms: 'refrigerator condenser coil cleaning brush', note: 'A long coil brush + vacuum does it. No replacement part needed.' } },
      { h3: 'Failed evaporator fan motor', p: 'The evaporator fan (behind the freezer back panel) pushes cold air into the fridge. If it\'s dead or noisy, the freezer may stay cold while the fridge goes warm.', part: { name: 'Evaporator fan motor', diff: 'moderate', price: '$25–75', terms: 'refrigerator evaporator fan motor', note: 'Listen for a whirring/chirping fan; silence with a cold freezer points here.' } },
      { h3: 'Defrost system failure (frost buildup)', p: 'A bad defrost heater, thermostat, or timer/control lets frost cake the evaporator coil until air can\'t move. Tell-tale: thick ice on the freezer back panel.', part: { name: 'Defrost thermostat / heater', diff: 'moderate', price: '$15–50', terms: 'refrigerator defrost thermostat kit', note: 'If you see heavy frost on the coil, this is your path.' } },
      { h3: 'Bad condenser fan motor', p: 'On coil-underneath models a condenser fan cools the compressor. If it seizes, the system overheats and cooling drops.', part: { name: 'Condenser fan motor', diff: 'moderate', price: '$25–70', terms: 'refrigerator condenser fan motor', note: 'Found near the compressor at the bottom-back.' } },
      { h3: 'Start relay or compressor (sealed system)', p: 'A clicking-then-quiet compressor can be a cheap start relay — or a failed compressor / refrigerant leak, which is a licensed job. Know the line.', part: { name: 'Compressor start relay', diff: 'pro', price: '$10–40', terms: 'refrigerator compressor start relay', note: 'The relay is cheap; anything into the sealed system needs a pro.' } },
    ],
    safe: ['Vacuum/brush the condenser coils (back or underneath) — free, and often the entire fix.', 'Make sure vents inside aren\'t blocked by food and the doors seal fully.', 'Check the freezer back panel for heavy frost (points to the defrost system).'],
    risk: ['Evaporator/condenser fan or defrost-thermostat replacement — doable, but UNPLUG the fridge and expect to remove an interior panel and let ice melt.'],
    pro: ['A silent compressor, or hissing/oily residue at the sealed system (refrigerant leak).', 'Anything requiring refrigerant — it\'s federally regulated and needs licensed equipment.'],
    worth: 'Depends where it lands. Coils, fans, and defrost parts are $8–75 and clearly worth it. A failed sealed system/compressor on an older fridge often isn\'t — the repair can approach the price of a new unit. Do the cheap checks first; if it\'s the sealed system on a 12+ year fridge, replacing is usually the smart call.',
    faq: [
      { q: 'Why is my refrigerator running but not cooling?', a: 'Most often dirty condenser coils, a dead evaporator fan, or a defrost-system failure burying the coil in frost. Start with the coils (free), then check the freezer back panel for ice.' },
      { q: 'Why is my freezer cold but the fridge warm?', a: 'Classic evaporator-fan or defrost failure — cold air isn\'t moving from the freezer into the fridge section. Check the evaporator fan behind the freezer panel.' },
      { q: 'Is it worth fixing a refrigerator that\'s not cooling?', a: 'If it\'s coils, a fan, or a defrost part — absolutely ($8–75). If it\'s the compressor or a refrigerant leak on an older fridge, replacement is usually smarter.' },
      { q: 'Can I recharge the refrigerant myself?', a: 'No. Refrigerant work is federally regulated and needs licensed equipment. A sealed-system fix is a pro job.' },
    ],
    related: [['freezer-not-freezing', 'Freezer Not Freezing'], ['dishwasher-not-draining', 'Dishwasher Not Draining'], ['washer-not-draining', 'Washer Not Draining']],
  },
  {
    slug: 'dishwasher-not-draining', appliance: 'Dishwasher', icon: '🍽️',
    h1: 'Dishwasher Not Draining?', h1em: 'Clear It Before You Buy.',
    title: 'Dishwasher Not Draining? The Real Cause + the Exact Part',
    desc: "Standing water in the dishwasher? It's usually the filter, the drain hose, or a new disposal's knockout plug — all cheap or free. Ant tells you which, and when it's the drain pump.",
    keywords: 'dishwasher not draining, dishwasher standing water, dishwasher filter clogged, dishwasher drain pump, dishwasher won\'t drain',
    quick: "Water left in the bottom means it isn't reaching the drain. Check the cheap stuff first: the filter basket packed with food, a kinked drain hose, or — if you just installed a garbage disposal — the knockout plug nobody removed. If those are clear and it still won't drain, the drain pump or check valve is the culprit.",
    causes: [
      { h3: 'Clogged filter basket', p: 'The cylindrical filter in the tub floor traps food. When it clogs, water can\'t drain. Twist it out, rinse it, and clear the sump — free, and the most common fix.', part: { name: 'No part — just clean it', diff: 'easy', price: 'Free', terms: 'dishwasher filter replacement', note: 'Only replace if the mesh is torn; usually a rinse is all it needs.' } },
      { h3: 'New disposal knockout plug left in', p: 'If a garbage disposal was recently installed, the drain line often connects to it — and there\'s a knockout plug that MUST be punched out. Miss it and the dishwasher can never drain.', part: { name: 'No part — punch out the plug', diff: 'easy', price: 'Free', terms: 'garbage disposal dishwasher knockout plug', note: 'Look inside the disposal\'s dishwasher inlet nipple for the plug.' } },
      { h3: 'Kinked or clogged drain hose', p: 'The hose under the sink can kink or clog at the high loop / air gap. Straighten and clear it before assuming a pump.', part: { name: 'Dishwasher drain hose', diff: 'moderate', price: '$12–30', terms: 'dishwasher drain hose', note: 'Replace only if split; usually just needs clearing.' } },
      { h3: 'Failed drain pump', p: 'If everything upstream is clear and it still won\'t drain, the drain pump has failed. It\'s under the tub and replaceable with basic tools.', part: { name: 'Dishwasher drain pump', diff: 'moderate', price: '$30–90', terms: 'dishwasher drain pump', note: 'Buy for your exact model — pumps aren\'t universal.' } },
    ],
    safe: ['Twist out and rinse the filter; scoop the sump.', 'If a disposal was just installed, confirm the knockout plug was removed.', 'Check the drain hose under the sink for kinks and clogs.'],
    risk: ['Drain pump or check-valve replacement — doable, but shut off power at the breaker and the water supply, and expect water in the base pan.'],
    pro: ['A leak reaching the control board or the wiring under the tub.', 'Any repair where you can\'t safely cut power and water first.'],
    worth: 'Almost always worth it. The top causes are free (filter, knockout plug) and the drain pump is $30–90. A new dishwasher is $500+ plus install. Draining problems are the cheapest, most beginner-friendly dishwasher repair.',
    faq: [
      { q: 'Why is there standing water in my dishwasher?', a: 'The water isn\'t reaching the drain — usually a clogged filter, a kinked drain hose, a disposal knockout plug left in, or a failed drain pump. Clear the filter first.' },
      { q: 'I just installed a garbage disposal and now my dishwasher won\'t drain — why?', a: 'The disposal ships with a knockout plug in its dishwasher inlet that must be punched out. If it wasn\'t removed, the dishwasher physically can\'t drain.' },
      { q: 'How do I clean a dishwasher that won\'t drain?', a: 'Remove the bottom rack, twist out the filter, rinse it, and scoop standing water and debris from the sump. Then check the drain hose for kinks.' },
      { q: 'How much is a dishwasher drain pump?', a: 'Usually $30–90 for the part, model-specific. Replacing it is a moderate DIY job with power and water shut off.' },
    ],
    related: [['washer-not-draining', 'Washer Not Draining'], ['refrigerator-not-cooling', 'Fridge Not Cooling'], ['oven-not-heating', 'Oven Not Heating']],
  },
  {
    slug: 'oven-not-heating', appliance: 'Oven', icon: '🍳',
    h1: 'Oven Not Heating?', h1em: 'Element or Igniter — Know Which.',
    title: 'Oven Not Heating? Electric Element vs Gas Igniter — the Exact Part',
    desc: "Oven won't heat or won't reach temp? On electric it's usually the bake element; on gas, the igniter. Ant names the exact part and flags the gas/240V jobs to leave to a pro.",
    keywords: 'oven not heating, oven won\'t heat, oven bake element, gas oven igniter, oven not reaching temperature, oven temp sensor',
    quick: "Electric and gas ovens fail differently. On an electric oven, a bake element that won't glow red (or is visibly split/blistered) is the usual culprit. On a gas oven, a weak igniter that glows but never lights the burner is the #1 failure. If it heats but the temp is off, suspect the oven temperature sensor.",
    causes: [
      { h3: 'Failed bake element (electric)', p: 'The lower element should glow bright red. If it stays dark, has a break, or is blistered, it\'s done. This is the most common electric-oven no-heat fix and one of the easiest.', part: { name: 'Oven bake element', diff: 'moderate', price: '$20–60', terms: 'oven bake element', note: 'Usually two screws inside the oven + two wires. Cut power first.' } },
      { h3: 'Weak gas oven igniter', p: 'On a gas oven the igniter both lights the gas and tells the valve to open. When it weakens it glows but never gets hot enough to open the valve — so no flame, no heat.', part: { name: 'Gas oven igniter', diff: 'pro', price: '$25–60', terms: 'gas oven igniter', note: 'Gas job — if you\'re not confident, get a pro. Shut off gas + power.' } },
      { h3: 'Bad oven temperature sensor', p: 'If the oven heats but runs cold, hot, or throws a temp error, the sensor (a probe inside the cavity) may be out of spec. Cheap and quick.', part: { name: 'Oven temperature sensor', diff: 'moderate', price: '$15–40', terms: 'oven temperature sensor probe', note: 'Unclips inside the oven and unplugs behind the back panel.' } },
      { h3: 'Failed broil element (broil only dead)', p: 'If bake works but broil doesn\'t (or vice-versa), the other element is out. Same swap as the bake element, up top.', part: { name: 'Oven broil element', diff: 'moderate', price: '$20–60', terms: 'oven broil element', note: 'Match the wattage/model — top-mounted version of the bake element.' } },
      { h3: 'Control board / relay', p: 'Less common: the board that switches power to the elements fails. Suspect it only after elements and sensor check out.', part: { name: 'Oven control board', diff: 'pro', price: '$80–250', terms: 'oven control board', note: 'Pricier and model-specific — confirm before buying.' } },
    ],
    safe: ['Watch the element: does the bake element glow fully red? A dark or split element is the answer.', 'Check for a tripped breaker (electric ovens are 240V).', 'Confirm the oven isn\'t in a delay/timer/Sabbath mode.'],
    risk: ['Electric bake/broil element or temp-sensor swap — beginner-friendly, but cut power at the breaker first (240V).'],
    pro: ['Anything on a gas oven — igniter, valve, or a gas smell.', 'The 240V terminal block, cord, or internal wiring.', 'A control board diagnosis you\'re not sure of.'],
    worth: 'Worth it for elements and sensors — $15–60 in parts and 20–30 minutes turn a dead oven into a working one versus $700+ for a new range. A gas igniter is cheap too but a gas job. Only a pricey control board on an older range tips toward replacement.',
    faq: [
      { q: 'Why is my electric oven not heating?', a: 'Usually a failed bake element. Turn on bake and watch — a healthy element glows bright red across its whole length. Dark spots, a break, or blistering mean it\'s time to replace it.' },
      { q: 'Why does my gas oven igniter glow but not light?', a: 'A weakened igniter still glows but can\'t draw enough current to open the gas valve, so no flame. It\'s the most common gas-oven failure and the igniter needs replacing.' },
      { q: 'Why does my oven heat to the wrong temperature?', a: 'The oven temperature sensor is likely out of spec. It\'s a cheap probe inside the cavity that\'s quick to swap.' },
      { q: 'Is it safe to replace an oven element myself?', a: 'On an electric oven, yes — with the breaker off. Gas igniter and valve work should go to a pro unless you\'re confident with gas.' },
    ],
    related: [['dishwasher-not-draining', 'Dishwasher Not Draining'], ['refrigerator-not-cooling', 'Fridge Not Cooling'], ['dryer-not-heating', 'Dryer Not Heating']],
  },
  {
    slug: 'freezer-not-freezing', appliance: 'Freezer', icon: '❄️',
    h1: 'Freezer Not Freezing?', h1em: 'Airflow First, Sealed System Last.',
    title: "Freezer Not Freezing? Real Causes + the Exact Part (and When to Stop)",
    desc: "Freezer not cold enough? Start free — coils, door seal, airflow — then the evaporator fan or defrost parts. Ant names the part and flags the sealed-system jobs for a pro.",
    keywords: 'freezer not freezing, freezer not cold enough, freezer evaporator fan, freezer defrost, freezer door gasket, deep freezer not working',
    quick: "A freezer that runs but won't get cold usually has an airflow or defrost problem, not a dead compressor. Clean the condenser coils, confirm the door gasket seals, then check the evaporator fan and defrost system. A silent compressor or a refrigerant leak is a licensed job — don't chase it on an old unit.",
    causes: [
      { h3: 'Dirty condenser coils', p: 'Dust-caked coils can\'t release heat, so the freezer struggles. Vacuum them (back or underneath) — free and often the whole fix.', part: { name: 'Coil cleaning brush', diff: 'easy', price: '$8–15', terms: 'refrigerator freezer condenser coil brush', note: 'A coil brush + vacuum. No replacement part needed.' } },
      { h3: 'Bad door gasket (warm air leaking in)', p: 'A cracked or loose door seal lets warm, humid air in — the freezer frosts up and never holds temp. The dollar-bill test: close the door on a bill; if it slides out easily, the gasket\'s shot.', part: { name: 'Freezer door gasket', diff: 'easy', price: '$30–90', terms: 'freezer door gasket seal', note: 'Model-specific — order by your model number.' } },
      { h3: 'Failed evaporator fan motor', p: 'The evaporator fan circulates cold air over the coil. If it\'s dead or iced-up, the freezer won\'t get cold even though the compressor runs.', part: { name: 'Evaporator fan motor', diff: 'moderate', price: '$25–75', terms: 'freezer evaporator fan motor', note: 'Behind the freezer back panel; listen for a dead or noisy fan.' } },
      { h3: 'Defrost system failure', p: 'A bad defrost heater, thermostat, or timer lets frost bury the coil until airflow stops. Tell-tale: a thick ice sheet on the back panel.', part: { name: 'Defrost thermostat / heater kit', diff: 'moderate', price: '$15–50', terms: 'freezer defrost thermostat heater kit', note: 'If the coil\'s iced over, this is your path.' } },
      { h3: 'Start relay or compressor (sealed system)', p: 'A clicking-then-silent compressor can be a cheap start relay — or a failed compressor / refrigerant leak, which is licensed work.', part: { name: 'Compressor start relay', diff: 'pro', price: '$10–40', terms: 'freezer compressor start relay', note: 'Relay is cheap; the sealed system itself needs a pro.' } },
    ],
    safe: ['Vacuum/brush the condenser coils — free, and often the fix.', 'Run the dollar-bill test on the door gasket; make sure the door fully seals.', 'Check the back panel for a heavy ice sheet (points to defrost).'],
    risk: ['Door gasket, evaporator fan, or defrost-thermostat replacement — doable, but UNPLUG first and let any ice melt before you work.'],
    pro: ['A silent compressor, or hissing/oily residue (refrigerant leak).', 'Anything into the sealed system — licensed equipment required.'],
    worth: 'Coils, gaskets, fans, and defrost parts are $8–90 and clearly worth fixing. A dead compressor or refrigerant leak on an older freezer usually isn\'t — that repair rivals the price of a new unit. Do the cheap airflow checks first.',
    faq: [
      { q: 'Why is my freezer running but not freezing?', a: 'Usually airflow or defrost — dirty coils, a bad door seal, a dead evaporator fan, or a defrost failure icing the coil. A truly dead compressor is less common.' },
      { q: 'How do I test my freezer door seal?', a: 'Close the door on a dollar bill. If it pulls out with no resistance, the gasket isn\'t sealing and warm air is leaking in — replace the gasket.' },
      { q: 'Why is there a sheet of ice on the back of my freezer?', a: 'The defrost system (heater, thermostat, or timer) has failed, so frost builds on the coil until air can\'t move. Replacing the defrost part clears it.' },
      { q: 'Is it worth repairing a freezer that won\'t freeze?', a: 'Yes for airflow/defrost/gasket parts ($8–90). For a failed compressor or refrigerant leak on an older unit, replacement is usually the better value.' },
    ],
    related: [['refrigerator-not-cooling', 'Fridge Not Cooling'], ['washer-not-draining', 'Washer Not Draining'], ['dryer-not-heating', 'Dryer Not Heating']],
  },
];

// ---- schema builders -------------------------------------------------------
function faqSchema(s) {
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: s.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
}
function breadcrumbSchema(s) {
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://applianceant.com/' },
    { '@type': 'ListItem', position: 2, name: s.appliance, item: 'https://applianceant.com/' },
    { '@type': 'ListItem', position: 3, name: s.h1.replace(/\?$/, ''), item: `https://applianceant.com/${s.slug}` },
  ] });
}
function howToSchema(s) {
  const steps = [...s.safe.map((t) => ({ '@type': 'HowToStep', text: t }))];
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'HowTo', name: `How to diagnose a ${s.appliance.toLowerCase()} that's ${s.h1.toLowerCase().replace(s.appliance.toLowerCase(), '').replace(/[^a-z ]/g, '').trim()}`, step: steps });
}

// ---- page renderer ---------------------------------------------------------
function renderPart(p) {
  const [label, color] = DIFF[p.diff];
  const isFree = /free/i.test(p.price);
  const btn = isFree
    ? `<span class="part-free">✅ No part needed — DIY it free</span>`
    : `<a class="part-btn" href="${amz(p.terms)}" target="_blank" rel="noopener sponsored">🔎 Find it on Amazon →</a>`;
  return `<div class="part">
        <div class="part-top"><span class="part-diff" style="color:${color};border-color:${color}55">${label}</span><span class="part-price">${esc(p.price)}</span></div>
        <h3>${esc(p.name)}</h3>
        ${p.sku ? `<p class="part-sku">Common fit: ${esc(p.sku)}</p>` : ''}
        ${btn}
        <p class="part-note">${esc(p.note)}</p>
      </div>`;
}

function renderPage(s) {
  const causeCards = s.causes.map((c) => `<div class="cause"><h3>${esc(c.h3)}</h3><p>${esc(c.p)}</p></div>`).join('');
  const partCards = s.causes.filter((c) => c.part).map((c) => renderPart(c.part)).join('\n      ');
  const li = (arr, bord) => `<div class="cause" style="border-left:3px solid ${bord}"><ul>${arr.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  const faq = s.faq.map((f) => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join('');
  const related = s.related.map(([slug, label]) => `<a href="/${slug}" class="related-link">${esc(label)}</a>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(s.desc)}">
<meta name="keywords" content="${esc(s.keywords)}">
<link rel="canonical" href="https://applianceant.com/${s.slug}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#050505">
<meta property="og:type" content="article">
<meta property="og:url" content="https://applianceant.com/${s.slug}">
<meta property="og:title" content="${esc(s.title)}">
<meta property="og:description" content="${esc(s.desc)}">
<meta property="og:site_name" content="Appliance Ant">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(s.title)}">
<meta name="twitter:description" content="${esc(s.desc)}">
<script type="application/ld+json">${faqSchema(s)}</script>
<script type="application/ld+json">${howToSchema(s)}</script>
<script type="application/ld+json">${breadcrumbSchema(s)}</script>
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
.cause-list{display:flex;flex-direction:column;gap:12px;margin-top:20px}
.cause{background:var(--surface);border:1px solid var(--bord2);border-radius:12px;padding:20px 22px;transition:border-color .2s}
.cause:hover{border-color:rgba(255,98,0,.4)}
.cause h3{font-family:var(--block);font-size:17px;letter-spacing:.03em;color:var(--white);margin-bottom:7px}
.cause p{font-size:13px;color:var(--gray);line-height:1.7}
.cause ul{margin:0;padding-left:18px;font-size:13px;color:var(--gray);line-height:1.75}
.cause li{margin-bottom:7px}
.cause li:last-child{margin-bottom:0}
/* parts layer — the money section */
.parts-intro{font-size:14px;color:var(--gray);line-height:1.8;margin-top:6px}
.parts-intro b{color:var(--white)}
.parts{display:grid;grid-template-columns:repeat(2,1fr);gap:13px;margin-top:22px}
.part{background:var(--surface);border:1px solid var(--bord2);border-radius:14px;padding:22px 22px;display:flex;flex-direction:column;transition:all .2s}
.part:hover{border-color:rgba(255,98,0,.45);transform:translateY(-2px)}
.part-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.part-diff{font-size:10px;letter-spacing:.07em;text-transform:uppercase;border:1px solid;border-radius:14px;padding:4px 10px}
.part-price{font-family:var(--block);font-size:18px;color:var(--white);letter-spacing:.03em}
.part h3{font-family:var(--block);font-size:19px;letter-spacing:.03em;color:var(--white);margin-bottom:6px}
.part-sku{font-size:11.5px;color:var(--green);line-height:1.5;margin-bottom:12px}
.part-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--orange);color:#000;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:12px 18px;border-radius:10px;text-decoration:none;transition:all .2s;margin-top:auto}
.part-btn:hover{background:var(--oran2);transform:translateY(-1px);box-shadow:0 6px 18px rgba(255,98,0,.28)}
.part-free{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--green);border:1px solid rgba(57,255,20,.25);border-radius:10px;padding:11px 14px;margin-top:auto;letter-spacing:.02em}
.part-note{font-size:11.5px;color:var(--gray);line-height:1.55;margin-top:11px}
.disclosure{font-size:11px;color:var(--gray2);line-height:1.6;margin-top:16px;letter-spacing:.02em}
/* local cross-link */
.local{background:linear-gradient(135deg,rgba(255,98,0,.08),rgba(255,98,0,.02));border:1px solid rgba(255,98,0,.28);border-radius:18px;padding:34px 30px;text-align:center}
.local h3{font-family:var(--block);font-size:27px;letter-spacing:.03em;color:var(--white);margin-bottom:10px}
.local p{font-size:14px;color:#d2d2d2;line-height:1.7;margin-bottom:20px}
.local p b{color:var(--white)}
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
@media(max-width:760px){.parts{grid-template-columns:1fr}.related-grid{grid-template-columns:1fr}.hero{padding:44px 20px 30px}.content{padding:0 20px 54px}nav{padding:14px 18px}.nav-tag{display:none}}
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
  <div class="breadcrumb"><a href="/">Home</a><span>›</span><a href="/">${esc(s.appliance)}</a><span>›</span>${esc(s.h1.replace(/\?$/, ''))}</div>
  <span class="hero-icon">${s.icon}</span>
  <div class="hero-label">${esc(s.appliance)} · DIY Diagnosis</div>
  <h1>${esc(s.h1)}<em>${esc(s.h1em)}</em></h1>
  <div class="quick"><p>${esc(s.quick)}</p></div>
</div>

<div class="content">

  <section class="section">
    <div class="klabel">What's actually wrong</div>
    <h2>The Most Likely Causes</h2>
    <p class="prose">Listed in rough order of how often they're the culprit. Work top-down — the cheap, free checks first, the parts after.</p>
    <div class="cause-list">${causeCards}</div>
  </section>

  <section class="section">
    <div class="klabel">Get the part</div>
    <h2>The Exact Parts — Shipped to Your Door</h2>
    <p class="parts-intro">Here's the honest part list for this symptom, cheapest-and-easiest first. We name it, tell you the DIY difficulty and typical price, and link you straight to it. <b>Always confirm the part fits your exact model number before buying</b> — same part name, many variants.</p>
    <div class="parts">
      ${partCards}
    </div>
    <p class="disclosure">Prices are typical ranges and vary by brand/model. Amazon links open a search for the part so you can match it to your model. As an Amazon Associate, Appliance Ant may earn from qualifying purchases — at no extra cost to you.</p>
  </section>

  <section class="section">
    <div class="klabel">Can you fix it yourself?</div>
    <h2>Safe to Try · Know the Risk · Call a Pro</h2>
    <p class="prose">General guidance, not professional advice. <strong>Always unplug the appliance (or shut off the gas/water) before you check anything.</strong> If it feels beyond you, that's exactly when to get a pro.</p>
    <div class="cause-list">
      <div class="cause" style="border-left:3px solid var(--green)"><h3>✅ Safe to try yourself</h3><ul>${s.safe.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="cause" style="border-left:3px solid var(--orange)"><h3>⚠️ Doable — know the risk</h3><ul>${s.risk.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="cause" style="border-left:3px solid #ff3b30"><h3>🛑 Call a pro — don't touch this</h3><ul>${s.pro.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
    </div>
  </section>

  <section class="section">
    <div class="klabel">Is it worth fixing?</div>
    <h2>The Honest Call</h2>
    <p class="prose">${esc(s.worth)}</p>
  </section>

  <section class="section">
    <div class="local">
      <h3>In Middle Tennessee or Louisiana?</h3>
      <p>Don't want to DIY it? <b>Our own family of technicians</b> will come fix it — honest flat pricing, usually same-day, 4.5★ from 1,000+ neighbors.</p>
      <a href="${REPAIR}/same-day-appliance-repair" class="btn-primary">🔧 Get it fixed by our techs →</a>
    </div>
  </section>

  <section class="section">
    <div class="klabel">FAQ</div>
    <h2>People Also Ask</h2>
    <div class="faq">${faq}</div>
  </section>

  <section class="section">
    <div class="klabel">Keep fixing</div>
    <h2>Other Things That Break</h2>
    <div class="related-grid">${related}</div>
  </section>

</div>

<footer>
  <div class="foot-links">
    <a href="/">Appliance Ant Home</a>
    <a href="${REPAIR}">TN Appliance Exchange (local repair)</a>
    <a href="${REPAIR}/appliance-repair-cost">Repair Cost</a>
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
let written = [];
for (const s of SYMPTOMS) {
  const html = renderPage(s);
  const file = path.join(OUT, `${s.slug}.html`);
  fs.writeFileSync(file, html, 'utf8');
  written.push(s.slug);
  console.log(`  ✓ ${s.slug}.html  (${(html.length / 1024).toFixed(1)} KB, ${s.causes.filter((c) => c.part).length} parts)`);
}
console.log(`\nWrote ${written.length} symptom pages to applianceant/`);
module.exports = { SYMPTOMS };
