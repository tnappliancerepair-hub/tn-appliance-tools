// component-knowledge — curated, tech-authored knowledge per appliance component:
// how it behaves when it fails (symptoms), how to TEST it safely, safety flags,
// and links to our own /fix authority pages. This is GROUND-TRUTH content (real
// repair knowledge), not a prediction — so it's reliable + on-brand ("run by real
// techs") and it helps a customer CONFIRM the failure before buying (returns-killer).
//
// Keyed by canonical component. `names` are aliases we match a customer's words to
// ("evaporator motor", "evap fan", etc.). fix_pages are REAL files in this repo.
'use strict';

const SITE = 'https://tnapplianceexchange.net';

const COMPONENTS = [
  {
    key: 'evaporator_fan_motor', appliance: 'refrigerator',
    names: ['evaporator motor', 'evaporator fan', 'evap fan', 'evap motor', 'freezer fan', 'evaporator fan motor'],
    symptoms: [
      'Fridge section is warm but the freezer is cold-ish (only the evaporator fan circulates cold air to the fridge).',
      'You hear a loud whirring, chirping, or grinding from the freezer — or unusual silence when the door is open.',
      'Frost builds unevenly, or the food warms while the compressor is clearly running.',
    ],
    how_to_test: [
      'Unplug the fridge first. Open the freezer, remove the rear panel to expose the evaporator fan.',
      'Spin the fan blade by hand — it should turn freely. If it is stiff, seized, or iced-solid against the shroud, that is your fault.',
      'Restore power and press the freezer door switch (or tape it) — the fan should spin up. No spin with good voltage at the motor = bad motor.',
      'With a multimeter, check the motor windings for continuity; open circuit = failed motor.',
    ],
    safety: '', fix_pages: ['/fix/refrigerator-not-cooling.html', '/refrigerator-repair.html'],
  },
  {
    key: 'condenser_fan_motor', appliance: 'refrigerator',
    names: ['condenser fan', 'condenser motor', 'condenser fan motor'],
    symptoms: [
      'Whole fridge (both sections) slowly warms up; compressor runs hot and long.',
      'Rattling/humming from the bottom-rear near the compressor, or it stops entirely.',
      'Coils are hot to the touch and the fan by them is not moving.',
    ],
    how_to_test: [
      'Unplug the fridge. Access the condenser fan at the lower rear (behind the access panel).',
      'Clear any dust/debris and spin the blade — should turn freely.',
      'Powered on with the compressor running, the fan should run too. No spin + good voltage = bad motor. Check windings for continuity.',
    ],
    safety: '', fix_pages: ['/fix/refrigerator-not-cooling.html', '/refrigerator-repair.html'],
  },
  {
    key: 'start_relay', appliance: 'refrigerator',
    names: ['start relay', 'compressor relay', 'overload', 'relay overload', 'ptc relay', 'hard start'],
    symptoms: [
      'Fridge is completely warm; compressor tries to start then clicks off every few minutes (clicking sound).',
      'Compressor is warm but never runs steadily; sometimes a faint buzz.',
    ],
    how_to_test: [
      'Unplug the fridge. Pull the relay off the compressor pins (lower-rear).',
      'Shake it — a rattle/burnt smell means it has failed.',
      'Check continuity across the relay terminals per the diagram; out of spec = replace. A 3-in-1 hard-start is the common universal fix.',
    ],
    safety: 'Sealed-system compressor work is pro-only; the relay/overload itself is a safe DIY swap.',
    fix_pages: ['/fix/refrigerator-not-cooling.html'],
  },
  {
    key: 'water_inlet_valve', appliance: 'multi',
    names: ['water inlet valve', 'inlet valve', 'water valve', 'fill valve'],
    symptoms: [
      'Washer/dishwasher fills slowly, not at all, or overfills (valve stuck open).',
      'Fridge ice maker or water dispenser stops producing.',
      'Sometimes a buzzing at the valve when it is energized.',
    ],
    how_to_test: [
      'Unplug the appliance and shut off the water. The valve is where the water line connects.',
      'Check the inlet screens for clogs first (common false alarm).',
      'Multimeter the solenoid coil(s) for continuity — open = bad. No fill with good voltage + water pressure = bad valve.',
    ],
    safety: '', fix_pages: ['/dishwasher-not-draining.html', '/refrigerator-repair.html', '/washer-repair.html'],
  },
  {
    key: 'drain_pump', appliance: 'multi',
    names: ['drain pump', 'pump', 'water pump'],
    symptoms: [
      'Standing water left in the tub; washer will not spin out / dishwasher will not drain.',
      'Humming without draining, or a rattly grinding (debris in the impeller).',
    ],
    how_to_test: [
      'Unplug the appliance. Check the pump/filter for a sock, glass, or debris jamming the impeller (most common).',
      'Spin the impeller — should turn freely.',
      'Check the pump motor for continuity; no run with good voltage = bad pump.',
    ],
    safety: '', fix_pages: ['/fix/washer-wont-drain.html', '/fix/dishwasher-wont-drain.html', '/dishwasher-not-draining.html'],
  },
  {
    key: 'dryer_heating_element', appliance: 'dryer',
    names: ['heating element', 'dryer element', 'element'],
    symptoms: [
      'Dryer runs and tumbles but the air is cold — clothes stay wet.',
      'Takes multiple cycles to dry, or heats weakly.',
    ],
    how_to_test: [
      'Unplug the dryer. Access the element (rear or side panel depending on brand).',
      'Multimeter the element for continuity — a broken coil reads open = replace.',
      'Also check the thermal fuse + high-limit thermostat (a blown thermal fuse causes no-heat too and is a cheap first check).',
    ],
    safety: '240V circuit — unplug before testing. Gas dryers: no-heat is usually the igniter/flame sensor, not an element.',
    fix_pages: ['/fix/dryer-not-heating.html', '/dryer-repair.html'],
  },
  {
    key: 'dryer_thermal_fuse', appliance: 'dryer',
    names: ['thermal fuse', 'thermal cutoff', 'fuse'],
    symptoms: [
      'Dryer runs but no heat (a blown thermal fuse cuts the heat circuit).',
      'On some models the dryer will not start at all.',
      'Often caused by a clogged vent overheating the dryer — clean the vent or it blows again.',
    ],
    how_to_test: [
      'Unplug the dryer. Find the thermal fuse on the blower housing or heat duct.',
      'Multimeter across it — should read continuity (near 0 ohms). Open = blown = replace.',
      'ALWAYS clean the full vent run; a blocked vent is why it blew.',
    ],
    safety: 'A blown thermal fuse is a symptom of a blocked vent (a fire risk) — clean the vent, do not just replace the fuse.',
    fix_pages: ['/fix/dryer-not-heating.html', '/dryer-vent-cleaning.html'],
  },
  {
    key: 'ice_maker', appliance: 'refrigerator',
    names: ['ice maker', 'icemaker', 'ice maker assembly', 'ice maker module'],
    symptoms: [
      'No ice, partial cubes, or hollow/small cubes; or it stops filling.',
      'Ice maker cycles but never ejects, or overflows.',
    ],
    how_to_test: [
      'Confirm the freezer is below ~10°F (ice makers will not cycle if the freezer is warm — fix cooling first).',
      'Check the fill tube is not frozen and the water inlet valve/line delivers water.',
      'Run the ice maker test/reset cycle (button or jumper per the module) — no cycle = bad module/assembly.',
    ],
    safety: '', fix_pages: ['/fix/refrigerator-not-cooling.html', '/refrigerator-repair.html'],
  },
  {
    key: 'oven_bake_element', appliance: 'oven',
    names: ['bake element', 'oven element', 'broil element', 'heating element oven'],
    symptoms: [
      'Electric oven will not heat or heats weakly / unevenly.',
      'Element does not glow, or has a visible break/blister/burn spot.',
    ],
    how_to_test: [
      'Unplug the range or shut the breaker. Inspect the element for breaks or blistering (a visible break = replace).',
      'Multimeter for continuity — open = failed.',
    ],
    safety: '240V — kill power at the breaker before testing.',
    fix_pages: ['/fix/oven-not-heating.html', '/oven-repair.html'],
  },
  {
    key: 'oven_igniter', appliance: 'oven',
    names: ['igniter', 'oven igniter', 'ignitor', 'glow bar'],
    symptoms: [
      'Gas oven will not heat; you may hear gas valve click but no flame, or a faint gas smell then nothing.',
      'Igniter glows weakly/orange but never lights the burner (weak igniters fail to open the valve).',
    ],
    how_to_test: [
      'Watch the igniter on a bake call: a healthy one glows bright and lights within ~90 sec. Glows but no flame = weak igniter, replace.',
      'Amp-clamp test (pro) confirms it is drawing below the valve-open threshold.',
    ],
    safety: 'GAS appliance — if you smell gas, stop and call a pro (615-857-8800). Gas work carries real risk; we recommend a tech.',
    fix_pages: ['/fix/oven-not-heating.html', '/oven-repair.html'],
  },
  {
    key: 'washer_lid_lock', appliance: 'washer',
    names: ['lid lock', 'lid switch', 'door lock', 'lid latch'],
    symptoms: [
      'Top-load washer fills but will not spin/agitate; often an F5/E2-type lid-lock error.',
      'You hear the lock try to engage and click repeatedly.',
    ],
    how_to_test: [
      'Unplug the washer. Inspect the lock assembly + manually cycle it — should latch cleanly.',
      'Multimeter the lock switch contacts for continuity in the locked state; no continuity = replace.',
    ],
    safety: '', fix_pages: ['/fix/washer-not-spinning.html', '/washer-repair.html'],
  },
  {
    key: 'door_gasket', appliance: 'refrigerator',
    names: ['door gasket', 'door seal', 'gasket', 'seal'],
    symptoms: [
      'Fridge runs constantly, sweats/condensation around the door, or warm spots near the seal.',
      'Visible tears, gaps, or the door does not "suck" shut.',
    ],
    how_to_test: [
      'Dollar-bill test: close the door on a bill — if it slides out with no drag, the seal is weak there.',
      'Inspect the whole gasket for tears/deformation; clean it first (grime breaks the seal).',
    ],
    safety: '', fix_pages: ['/fix/refrigerator-not-cooling.html'],
  },
  // ---- universal maintenance items (the beachhead SKUs) ----
  {
    key: 'washer_fill_hose', appliance: 'washer',
    names: ['washer hose', 'fill hose', 'supply hose', 'inlet hose', 'washer supply line', 'braided washer hose'],
    symptoms: [
      'Bulging, cracking, rust at the fittings, or dampness/drips behind the washer.',
      'Rubber hoses over ~5 years old are the #1 cause of laundry-room floods — replace proactively.',
    ],
    how_to_test: [
      'Shut off the water. Feel the hose for stiffness/cracks and check the fittings for corrosion or weeping.',
      'Any bulge or crack = replace now. Stainless-braided lines are the upgrade.',
    ],
    safety: '', fix_pages: ['/washer-repair.html'],
  },
  {
    key: 'dryer_vent_hose', appliance: 'dryer',
    names: ['dryer vent hose', 'vent hose', 'transition duct', 'dryer duct', 'exhaust hose'],
    symptoms: [
      'Long dry times, hot laundry room, or a crushed/kinked duct behind the dryer.',
      'Lint escaping at the connection — a fire risk.',
    ],
    how_to_test: [
      'Pull the dryer out and inspect the duct for crushing, kinks, or lint packing.',
      'A fresh, smooth duct + a clean full vent run restores airflow and safety.',
    ],
    safety: 'A clogged/crushed vent is a leading dryer-fire cause — pair a new hose with a full vent cleaning.',
    fix_pages: ['/dryer-vent-cleaning.html', '/fix/dryer-not-heating.html'],
  },
  {
    key: 'fridge_water_line', appliance: 'refrigerator',
    names: ['fridge water line', 'water line', 'ice maker line', 'ice maker connector', 'water supply line'],
    symptoms: [
      'Slow leak/puddle under or behind the fridge; low water/ice output.',
      'Kinked or brittle plastic line — the hidden under-floor leak source.',
    ],
    how_to_test: [
      'Trace the line from the shutoff to the fridge; feel for dampness at fittings and check for kinks.',
      'Braided stainless upgrade prevents the slow under-floor leak.',
    ],
    safety: '', fix_pages: ['/refrigerator-repair.html'],
  },
  {
    key: 'dishwasher_supply_line', appliance: 'dishwasher',
    names: ['dishwasher supply line', 'dishwasher water line', 'dishwasher hose'],
    symptoms: [
      'Slow leak under the sink/cabinet where the supply connects — often unseen for months.',
      'Brittle or corroded fitting at the shutoff.',
    ],
    how_to_test: [
      'Shut off the water; inspect the braided line + fittings under the sink for corrosion or weeping.',
      'Replace while the unit is out — a slow leak here rots the cabinet.',
    ],
    safety: '', fix_pages: ['/dishwasher-not-draining.html'],
  },
];

// Build alias index once.
const INDEX = [];
for (const c of COMPONENTS) for (const n of c.names) INDEX.push({ alias: n.toLowerCase(), c });

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

// Match a customer's words ("bad evaporator motor", a part description, a symptom
// phrase) to the best component entry. Returns the entry or null.
function match(query) {
  const q = norm(query);
  if (!q) return null;
  // longest alias that appears in the query wins (so "evaporator fan motor" beats "motor")
  let best = null, bestLen = 0;
  for (const row of INDEX) {
    if (q.includes(row.alias) && row.alias.length > bestLen) { best = row.c; bestLen = row.alias.length; }
  }
  return best;
}

function withLinks(c) {
  if (!c) return null;
  return {
    key: c.key, appliance: c.appliance, matched_names: c.names,
    symptoms: c.symptoms, how_to_test: c.how_to_test, safety: c.safety || '',
    links: (c.fix_pages || []).map((p) => ({ url: SITE + p, label: p.replace(/^\/(fix\/)?/, '').replace(/\.html$/, '').replace(/-/g, ' ') })),
  };
}

module.exports = { COMPONENTS, match, withLinks, norm };
