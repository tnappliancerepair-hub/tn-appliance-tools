// brand-symptom-knowledge.js — the brand-specific repair knowledge layer for the
// Ant knowledge base. Combined with the deep base symptom content (troubleshooting-
// content.js) it produces genuinely differentiated brand pages (NOT thin doorways):
// each page has the universal symptom guide PLUS what's actually different about THAT
// brand — the model families that fail this way, the real fault codes, the known
// design issues, and the safe DIY reset/force-mode steps unique to that brand.
//
// This is the moat: accurate, technician-grade, brand-specific knowledge that AIs
// and voice assistants quote. Target the proven high-volume queries first
// (e.g. "samsung refrigerator not cooling" ~6,600/mo, "lg" ~5,400/mo).
//
// Structure: KB[symptomSlug][brand] = {
//   lede, causes:[{name,why,diy,difficulty}], faultCodes:[{code,meaning}],
//   knownIssue, forceReset }
'use strict';

module.exports = {
  'refrigerator-not-cooling': {
    Samsung: {
      lede: 'Samsung refrigerators — especially the French-door RF-series — most often stop cooling because the evaporator coil behind the back freezer panel frosts over and blocks airflow. The classic sign is a fridge section that\'s warm while the freezer still feels cold ("Twin Cooling" imbalance). It usually traces to the defrost sensor, defrost heater, or a control issue, not the compressor.',
      causes: [
        { name: 'Frosted evaporator coil (defrost failure)', why: 'On many RF/RS models the defrost sensor or heater fails and ice builds on the coil behind the rear freezer panel, choking airflow to the fridge. Fridge goes warm, freezer stays cold.', diy: 'Empty the freezer, unplug for 24–48 hours to fully defrost, then plug back in. If it cools for a few days then quits again, the defrost system needs the part replaced.', difficulty: 'Moderate' },
        { name: 'Evaporator or condenser fan', why: 'A failed evap fan (fault 22E/21E) stops cold air moving; a failed condenser fan lets the compressor overheat.', diy: 'Listen for fan noise. A grinding or silent fan compartment points here — a technician repair.', difficulty: 'Pro' },
        { name: 'Ice buildup on the ice-room fan (40E/41E)', why: 'On French-door models the ice-room fan ices up and can\'t circulate.', diy: 'Force-defrost (below) can clear it temporarily; the root fix is the seal/heater.', difficulty: 'Moderate' },
      ],
      faultCodes: [
        { code: '22 E / 21 E', meaning: 'Freezer / fridge evaporator fan error' },
        { code: '5 E', meaning: 'Fridge defrost sensor error' },
        { code: '40 E / 41 E', meaning: 'Ice-room fan error (French-door)' },
        { code: '84 C / 85 C', meaning: 'Compressor / inverter error' },
      ],
      knownIssue: 'Samsung RF French-door models from the mid-2010s are widely known for evaporator frost-up and ice-maker frosting — a class of complaints big enough that it shaped Samsung\'s later designs. If yours is one of these, the defrost repair is common and worth doing.',
      forceReset: 'Force Defrost: with the doors open, press and hold Freezer + Fridge (or Energy Saver + Fridge on some models) for ~8 seconds until the display blanks, then press until you see "Fd." This runs a manual defrost — helpful to diagnose a frost-up.',
    },
    LG: {
      lede: 'When an LG refrigerator stops cooling and BOTH the fridge and freezer are warm, the number-one suspect is the linear (inverter) compressor. LG\'s linear compressors from roughly 2014–2019 had a well-documented failure rate that led to a class-action settlement — and the good news is they carry a 10-year compressor warranty, so the part is often covered.',
      causes: [
        { name: 'Linear/inverter compressor failure', why: 'Both compartments warm, compressor not running (no gentle hum) or clicking on and off = the linear compressor or its inverter control board. This is THE common LG failure.', diy: 'Check your model/serial against the LG settlement and warranty — the compressor is often covered 10 years. Diagnosis and replacement are a technician job.', difficulty: 'Pro' },
        { name: 'Dirty condenser coils / condenser fan', why: 'Coils packed with dust make the compressor overheat and cut out.', diy: 'Unplug, pull the fridge out, vacuum the condenser coils at the bottom/back. Free and safe.', difficulty: 'Easy' },
        { name: 'Evaporator fan or defrost', why: 'If only the fridge is warm and the freezer is fine, it\'s more likely the evap fan or defrost than the compressor.', diy: 'Listen for the evap fan behind the freezer panel.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'No user code', meaning: 'LG fridges rarely show a cooling fault code to the user; diagnosis is by symptom + a technician\'s test mode' },
      ],
      knownIssue: 'LG linear-compressor fridges (2014–2019) are the single most-searched "not cooling" complaint in the country. Before paying for a compressor, verify warranty coverage — LG covers the linear compressor for 10 years and settled a class action over these failures.',
      forceReset: 'A power-cycle (unplug 30 seconds, plug back in) clears a stuck inverter board and is worth trying first. If both sides are warm again within hours, suspect the compressor.',
    },
    Whirlpool: {
      lede: 'Whirlpool refrigerators (and their Maytag, KitchenAid, and Amana siblings) that stop cooling usually come down to the defrost system or the evaporator fan on top-freezer and side-by-side models. A warm fridge with a working freezer is a classic defrost-thermostat or adaptive-defrost-control symptom.',
      causes: [
        { name: 'Defrost thermostat / adaptive defrost control', why: 'When the defrost cycle quits, frost builds on the evaporator and airflow to the fridge stops.', diy: 'Unplug and fully defrost for 24 hours; if it cools then fails again in a few days, the defrost part is the fix.', difficulty: 'Moderate' },
        { name: 'Evaporator fan motor', why: 'No cold-air circulation from the freezer to the fridge.', diy: 'Listen for the fan behind the freezer back panel — silence points here.', difficulty: 'Pro' },
        { name: 'Dirty condenser coils', why: 'Overheated compressor cuts out on side-by-sides.', diy: 'Vacuum the coils (bottom front or back). Easy and free.', difficulty: 'Easy' },
      ],
      faultCodes: [
        { code: 'PO / power outage', meaning: 'Displays a past power-loss alert on some models — clear it and confirm cooling resumes' },
      ],
      knownIssue: 'Whirlpool-built fridges are generally the most repairable and parts-friendly on the market — a not-cooling Whirlpool is almost always worth fixing because the common parts (defrost thermostat, evap fan) are inexpensive and widely available.',
      forceReset: 'Unplug for 24 hours to fully clear an evaporator frost-up, then restore power. If cooling returns then fails again within days, the defrost system needs the part.',
    },
    GE: {
      lede: 'GE refrigerators that stop cooling split two ways: the newer models often have a main control board or evaporator fan issue, while older GE units are known for sealed-system (refrigerant) failures. A warm fridge with a cold freezer is usually fixable; both sides warm on an older GE can be the sealed system.',
      causes: [
        { name: 'Evaporator fan / defrost', why: 'Fridge warm, freezer cold = airflow or defrost, not refrigerant.', diy: 'Listen for the evap fan; force a manual defrost by unplugging 24 hours.', difficulty: 'Moderate' },
        { name: 'Main control / motherboard', why: 'GE boards are a known weak point — a failed board can stop the compressor or fans.', diy: 'Not a DIY diagnosis; a technician confirms with test points.', difficulty: 'Pro' },
        { name: 'Sealed system (older units)', why: 'A refrigerant leak or compressor on an older GE means both compartments slowly warm.', diy: 'Sealed-system work is licensed-only. Get an honest repair-vs-replace call first.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'Varies by model', meaning: 'Many GE models show board fault codes only in a technician service mode' },
      ],
      knownIssue: 'GE main control boards are the notable recurring failure. On an older GE with a suspected sealed-system leak, get the honest repair-vs-replace math before spending — sometimes replacement wins.',
      forceReset: 'Unplug 30 seconds to reset the control board; unplug 24 hours to clear an evaporator frost-up.',
    },
    Frigidaire: {
      lede: 'Frigidaire (and Electrolux) refrigerators that stop cooling are most often an evaporator fan or a defrost problem — both affordable, common repairs. A warm fridge with a working freezer is the classic airflow/defrost signature and is well worth fixing.',
      causes: [
        { name: 'Evaporator fan motor', why: 'Frigidaire evap fans are a frequent failure — no fan, no cold air to the fridge.', diy: 'Listen for the fan behind the freezer back panel.', difficulty: 'Pro' },
        { name: 'Defrost heater / timer', why: 'A dead defrost cycle ices the coil and blocks airflow.', diy: 'Unplug and defrost 24 hours; if it cools then fails again, replace the defrost part.', difficulty: 'Moderate' },
        { name: 'Dirty condenser coils', why: 'Overheating compressor.', diy: 'Vacuum the coils. Free and safe.', difficulty: 'Easy' },
      ],
      faultCodes: [
        { code: 'SY EF', meaning: 'Evaporator fan circuit error' },
        { code: 'SY CE', meaning: 'Communication error between control boards' },
      ],
      knownIssue: 'Frigidaire evaporator fan motors and defrost parts are inexpensive and the repair is straightforward — a not-cooling Frigidaire is almost always worth fixing rather than replacing.',
      forceReset: 'Unplug for 24 hours to clear an evaporator frost-up, then restore power and watch whether the fridge holds temperature.',
    },
  },

  'dryer-not-heating': {
    Samsung: {
      lede: 'A Samsung dryer that tumbles but won\'t heat is almost always the heating element or a thermal fuse that blew because the vent is clogged. The element (part family DC47-00019A) is a common, affordable replacement — but if you don\'t clear the vent that blew the fuse, the fix won\'t last.',
      causes: [
        { name: 'Clogged vent (root cause)', why: 'A restricted vent overheats the dryer and trips the thermal fuse — the #1 reason a Samsung suddenly runs cold.', diy: 'Disconnect and clear the vent hose and wall duct. Do this first, every time.', difficulty: 'Easy' },
        { name: 'Heating element', why: 'The element burns out and the dryer runs cold while tumbling normally.', diy: 'Element replacement is a technician job (rear-panel disassembly + meter test).', difficulty: 'Pro' },
        { name: 'Thermal fuse', why: 'A one-time safety fuse that cuts heat after an overheat — always paired with a vent clog.', diy: 'Clear the vent; the fuse itself is a technician replacement.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: 'HC / hE', meaning: 'Heating error (element/thermistor)' }],
      knownIssue: 'Samsung dryer heating elements and thermal fuses are common, inexpensive parts — the repair is well worth it. Always clear the vent at the same time or the new fuse will blow again.',
      forceReset: 'Unplug the dryer for 1 minute to clear a heating-error code, then run a test cycle after the vent is confirmed clear.',
    },
    LG: {
      lede: 'LG dryers are unusually helpful here: many display a flow-sensor code that tells you the vent is blocked before anything fails. A "d80," "d90," or "d95" isn\'t a breakdown — it\'s LG telling you the exhaust is 80–95% restricted. Clear the vent and the heat usually returns.',
      causes: [
        { name: 'Restricted vent (d80/d90/d95)', why: 'LG\'s flow sensor measures exhaust restriction and shows the percentage blocked. This is the most common "won\'t heat properly" cause.', diy: 'Clear the vent hose and wall duct completely, then re-run. The code should drop.', difficulty: 'Easy' },
        { name: 'Heating element', why: 'On electric LG dryers the element burns out and it runs cold.', diy: 'Technician replacement after a meter test.', difficulty: 'Pro' },
        { name: 'Thermistor / thermal fuse', why: 'A bad thermistor or a fuse blown by overheating cuts the heat.', diy: 'Clear the vent first; the parts are a technician repair.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'd80 / d90 / d95', meaning: 'Exhaust vent 80% / 90% / 95% blocked — clear the vent' },
        { code: 'tE', meaning: 'Thermistor (temperature sensor) error' },
      ],
      knownIssue: 'The d80/d90/d95 codes fool people into buying parts — 9 times out of 10 it\'s literally a clogged vent. Clean the whole run to the outside wall before replacing anything.',
      forceReset: 'Power the dryer off and unplug for 1 minute to clear the code, clean the vent, then restart.',
    },
    Whirlpool: {
      lede: 'A Whirlpool, Maytag, or Kenmore dryer that runs but won\'t heat is a textbook case: heating element, thermal fuse, or cycling thermostat — and very often a clogged vent behind it all. These are inexpensive, widely available parts and the repair is almost always worth it.',
      causes: [
        { name: 'Clogged vent (root cause)', why: 'Overheating from a restricted vent trips the thermal fuse or high-limit thermostat.', diy: 'Clear the vent hose and duct first — this alone fixes many "no heat" calls.', difficulty: 'Easy' },
        { name: 'Heating element', why: 'Burns out over time on electric models; dryer tumbles but stays cold.', diy: 'Technician replacement after a meter test.', difficulty: 'Pro' },
        { name: 'Thermal fuse / cycling thermostat', why: 'Safety devices that cut heat after an overheat.', diy: 'Clear the vent; the parts are a straightforward technician repair.', difficulty: 'Pro' },
        { name: 'Lost 240V leg (electric)', why: 'One failed breaker leg lets it tumble on 120V but the element gets no power.', diy: 'Fully switch the double breaker off and back on.', difficulty: 'Easy' },
      ],
      faultCodes: [{ code: 'F: E cycle codes', meaning: 'Some newer models show fault codes in a service mode' }],
      knownIssue: 'Whirlpool-platform dryers are the most repairable in the trade — parts are cheap and everywhere. A no-heat Whirlpool is worth fixing at almost any age.',
      forceReset: 'Reset the wall breaker fully (both legs), clear the vent, then test a heat cycle.',
    },
    GE: {
      lede: 'A GE dryer that tumbles without heat is usually the heating coil/element, a thermal cutoff, or the vent that overheated it. GE elements are affordable and the repair is straightforward.',
      causes: [
        { name: 'Clogged vent (root cause)', why: 'Trips the thermal cutoff from overheating.', diy: 'Clear the vent and duct first.', difficulty: 'Easy' },
        { name: 'Heating element/coil', why: 'Burns out; runs cold while tumbling.', diy: 'Technician replacement.', difficulty: 'Pro' },
        { name: 'Thermal cutoff', why: 'Safety device that opens after an overheat.', diy: 'Clear the vent; part is a technician repair.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: 'E-codes vary', meaning: 'Newer GE dryers show codes in service mode' }],
      knownIssue: 'GE dryer heating parts are inexpensive and common — worth repairing. Vent first, always.',
      forceReset: 'Unplug 1 minute, clear the vent, retest.',
    },
  },

  'washer-wont-drain': {
    Samsung: {
      lede: 'A Samsung washer that won\'t drain almost always throws a drain error — 5E, SE, 5C, or nc — and the fix is usually the pump filter (debris/coin trap) on the front-load models. It\'s one of the easiest repairs there is.',
      causes: [
        { name: 'Clogged pump filter / coin trap', why: 'Samsung front-loaders have a filter behind a small bottom-front door that catches coins, hairpins, and lint.', diy: 'Unplug, put towels down, open the small bottom-front panel, and slowly unscrew the filter to drain and clean it.', difficulty: 'Easy' },
        { name: 'Kinked or clogged drain hose', why: 'The hose to the standpipe kinks or clogs.', diy: 'Check the hose behind the machine for kinks.', difficulty: 'Easy' },
        { name: 'Drain pump', why: 'A hum with no draining points at a failed pump.', diy: 'Technician replacement.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: '5E / SE / 5C / nc', meaning: 'Drain error — check pump filter and hose first' }],
      knownIssue: 'The 5E/SE drain code is one of the most common Samsung washer complaints and is usually just a clogged filter — a 10-minute free fix before you call anyone.',
      forceReset: 'Unplug 1 minute to clear the code after cleaning the filter, then run a rinse/spin to confirm.',
    },
    LG: {
      lede: 'An LG washer that won\'t drain shows an "OE" (outlet error) code, and it\'s almost always a clogged drain pump filter or a kinked hose — not a broken machine. LG front-loaders make this an easy DIY.',
      causes: [
        { name: 'Clogged drain pump filter', why: 'The filter behind the small bottom-front cover catches debris and stops the drain.', diy: 'Unplug, towels down, open the bottom-front cover, drain via the small hose, then unscrew and clean the filter.', difficulty: 'Easy' },
        { name: 'Kinked/clogged drain hose', why: 'Hose pinched behind the machine or pushed too far down the standpipe.', diy: 'Check for kinks; don\'t insert the hose more than a few inches into the drain.', difficulty: 'Easy' },
        { name: 'Drain pump', why: 'Humming with no water movement = pump.', diy: 'Technician replacement.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: 'OE', meaning: 'Drain (outlet) error — clean the pump filter and check the hose' }],
      knownIssue: 'OE on an LG washer is overwhelmingly a clogged filter or hose. Clean the filter before buying a pump.',
      forceReset: 'Power off and unplug 1 minute after cleaning the filter, then run Spin Only to confirm the OE clears.',
    },
    Whirlpool: {
      lede: 'A Whirlpool or Maytag washer that won\'t drain is usually a clogged pump, a drain hose issue, or an object caught in the pump. High-efficiency top-loaders may show an "F9 E1" long-drain fault. All are common, affordable fixes.',
      causes: [
        { name: 'Clogged drain pump / filter', why: 'Debris or a small item blocks the pump or its filter (where equipped).', diy: 'Unplug, put towels down, and check the pump/filter access for clogs.', difficulty: 'Moderate' },
        { name: 'Kinked drain hose', why: 'Hose crushed behind the machine.', diy: 'Straighten the hose; check the standpipe height.', difficulty: 'Easy' },
        { name: 'Failed drain pump', why: 'Hum with no drain = pump motor.', diy: 'Technician replacement.', difficulty: 'Pro' },
        { name: 'Lid switch (top-load)', why: 'A bad lid switch stops the drain/spin from starting.', diy: 'Confirm the lid clicks shut; the switch is a technician repair.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: 'F9 E1', meaning: 'Long drain — water not draining fast enough (pump/hose/filter)' }],
      knownIssue: 'Whirlpool/Maytag drain parts are cheap and available; the F9 E1 long-drain fault is a plumbing/pump clog far more often than a dead pump.',
      forceReset: 'Unplug 1 minute, clear the clog, run a Drain/Spin cycle to confirm.',
    },
    GE: {
      lede: 'A GE washer that won\'t drain is typically a clogged pump, a kinked drain hose, or a failed drain pump. Front-load and newer top-load GE models make the pump accessible for a straightforward repair.',
      causes: [
        { name: 'Clogged pump / hose', why: 'Debris blocks the pump or the drain hose kinks.', diy: 'Unplug, towels down, check the drain hose for kinks and the pump inlet for debris.', difficulty: 'Moderate' },
        { name: 'Failed drain pump', why: 'Humming with no drain.', diy: 'Technician replacement.', difficulty: 'Pro' },
        { name: 'Lid switch / door lock', why: 'The machine won\'t drain/spin if it doesn\'t sense the lid/door secure.', diy: 'Confirm it latches; the switch is a technician repair.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: 'Model-specific', meaning: 'Some GE washers show drain faults in service mode' }],
      knownIssue: 'GE drain repairs are affordable and common — a washer that won\'t drain is worth fixing on any GE.',
      forceReset: 'Unplug 1 minute after clearing the clog, then run Drain/Spin.',
    },
  },

  'dishwasher-wont-drain': {
    Samsung: {
      lede: 'A Samsung dishwasher that won\'t drain usually shows a 5E, 5C, or OE code and comes down to a clogged filter, drain hose, or drain pump. Standing water at the bottom is the tell — and the filter is the first, easiest thing to clean.',
      causes: [
        { name: 'Clogged filter', why: 'The bottom filter clogs with food and blocks the drain.', diy: 'Pull the bottom rack, twist out the filter cup, rinse it under the tap. Do this monthly.', difficulty: 'Easy' },
        { name: 'Kinked/clogged drain hose or air gap', why: 'The hose to the disposal/standpipe clogs, or a new disposal\'s knockout plug was never removed.', diy: 'If recently paired with a new disposal, confirm the knockout plug was removed.', difficulty: 'Moderate' },
        { name: 'Drain pump', why: 'A hum with standing water points at the pump.', diy: 'Technician replacement.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: '5E / 5C / OE', meaning: 'Drain error — clean filter, check hose and pump' }],
      knownIssue: 'A brand-new disposal with the knockout plug left in is a shockingly common "dishwasher won\'t drain" cause on Samsung installs — check that first if it started after a disposal swap.',
      forceReset: 'Unplug or trip the breaker for 1 minute after cleaning the filter, then run a short cycle.',
    },
    LG: {
      lede: 'An LG dishwasher that won\'t drain shows an "OE" code — the same outlet-error family as their washers. It\'s almost always the filter or drain hose, not the pump.',
      causes: [
        { name: 'Clogged filter', why: 'Food debris in the bottom filter blocks the drain.', diy: 'Remove the bottom rack, twist out and rinse the filter assembly.', difficulty: 'Easy' },
        { name: 'Drain hose / air gap clog', why: 'Hose to the disposal/standpipe or the countertop air gap clogs.', diy: 'Clean the air gap; check for a disposal knockout plug if recently installed.', difficulty: 'Moderate' },
        { name: 'Drain pump', why: 'Standing water with a hum = pump.', diy: 'Technician replacement.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: 'OE', meaning: 'Drain (outlet) error — clean filter and hose' }],
      knownIssue: 'OE on an LG dishwasher is the same story as the washer: clean the filter and check the hose before buying a pump.',
      forceReset: 'Cut power 1 minute after cleaning the filter, then run a rinse cycle to confirm OE clears.',
    },
    Whirlpool: {
      lede: 'A Whirlpool or KitchenAid dishwasher that won\'t drain usually has a clogged filter, a stuck check valve, or a jammed chopper/drain pump. Standing water at the bottom is normal to a point — a full pool that won\'t clear needs attention.',
      causes: [
        { name: 'Clogged filter', why: 'The lower filter clogs with food.', diy: 'Remove the bottom rack, twist out and rinse the filter. Monthly habit.', difficulty: 'Easy' },
        { name: 'Check valve / drain hose', why: 'A stuck check valve lets water back in, or the hose clogs.', diy: 'Check for a disposal knockout plug if recently installed.', difficulty: 'Moderate' },
        { name: 'Chopper / drain pump', why: 'A jammed chopper blade or failed pump stops the drain.', diy: 'Technician repair.', difficulty: 'Pro' },
      ],
      faultCodes: [{ code: 'Clean / blinking lights', meaning: 'Many Whirlpool models flash a light sequence for a drain fault instead of a text code' }],
      knownIssue: 'Whirlpool/KitchenAid dishwasher drain parts are inexpensive and the filter fix is free — worth repairing at any age.',
      forceReset: 'Trip the breaker 1 minute, clean the filter, run a short cycle to confirm drainage.',
    },
    Bosch: {
      lede: 'A Bosch dishwasher that won\'t drain typically shows an E24 or E25 error — E24 is a drainage problem (filter/hose), E25 points at the drain pump or its cover. Bosch\'s design makes the filter cleanup easy and the fix affordable.',
      causes: [
        { name: 'Clogged filter (E24)', why: 'Bosch\'s fine filter clogs and blocks the drain — E24.', diy: 'Twist out the cylindrical filter at the bottom and rinse it thoroughly.', difficulty: 'Easy' },
        { name: 'Drain hose / high loop', why: 'A kinked hose or missing high loop causes drain-back.', diy: 'Confirm the drain hose has a high loop under the counter and isn\'t kinked.', difficulty: 'Moderate' },
        { name: 'Drain pump / pump cover (E25)', why: 'A dislodged pump cover or debris in the impeller — E25.', diy: 'With power off, lift out the pump cover under the filter and clear any debris (a common fix).', difficulty: 'Moderate' },
      ],
      faultCodes: [
        { code: 'E24', meaning: 'Water not draining — clean filter and check the hose' },
        { code: 'E25', meaning: 'Drain pump / pump cover — clear debris or reseat the cover' },
      ],
      knownIssue: 'The E24/E25 pair is the most common Bosch complaint and is usually a filter clean or reseating the pump cover — rarely a new part. Bosch dishwashers are worth keeping.',
      forceReset: 'Hold the Start button ~3 seconds to cancel/drain; if that won\'t clear it, cut power 1 minute, clean the filter and pump cover, and retry.',
    },
  },
  'washer-not-spinning': {
    'Samsung': {
      lede: 'Samsung washers — especially the front-load WF-series — most often won\'t spin because they can\'t drain first: the machine won\'t go into a high-speed spin with water still in the tub. The usual culprit is a clogged pump filter. After that it\'s an unbalanced load (UB) stopping the spin, or worn suspension.',
      causes: [
        { name: 'Won\'t drain (clogged pump filter)', why: 'A washer won\'t spin until the water is out. Lint, coins, and hairpins collect in the pump filter behind the lower-front door and block the drain, so the spin never starts.', diy: 'Open the small filter door at the lower front, have a pan and towels ready, and slowly open the drain filter to clear it. Then run a spin-only cycle.', difficulty: 'Moderate' },
        { name: 'Unbalanced load (UB/UE)', why: 'A single heavy item or a tiny load bunches to one side; the washer senses it thumping and refuses to ramp up to spin.', diy: 'Redistribute the load evenly and add a couple towels to balance a bulky item. Restart the spin.', difficulty: 'Easy' },
        { name: 'Door not locked (front-load)', why: 'A front-loader won\'t spin unless the door lock confirms the door is shut. A failing lock stops the spin.', diy: 'Make sure the door clicks fully shut. If it won\'t lock (or throws a door code), the door lock assembly is the fix.', difficulty: 'Pro' },
        { name: 'Worn suspension or drive belt', why: 'Worn shock absorbers let the drum swing and trip UB; a stretched/broken belt means the motor turns but the drum doesn\'t.', diy: 'Repeated UB on balanced loads = worn shocks; a motor that runs with no drum spin = belt. Both are affordable tech repairs.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'UB / UE', meaning: 'Unbalanced load — redistribute and re-spin' },
        { code: '4C / 5C', meaning: 'Water supply / drain issue — check the pump filter and hoses' },
        { code: 'dC / DC', meaning: 'Door won\'t lock (front-load) — check the door lock' },
      ],
      knownIssue: 'On Samsung front-loaders the #1 "won\'t spin" cause is a clogged pump filter — it can\'t drain, so it never spins. Clean that filter first; many "dead" spins come right back to life.',
      forceReset: 'Run a Spin Only cycle after clearing the pump filter. To reset: unplug for 1 minute, confirm the door latches, and restart.',
    },
    'LG': {
      lede: 'LG washers use a direct-drive motor with no belt, so the motor itself rarely fails. When an LG won\'t spin it\'s almost always because it can\'t drain (OE) or the load is unbalanced (UE) — or the door didn\'t lock. The classic is a clogged drain pump filter blocking the drain, so the spin never begins.',
      causes: [
        { name: 'Won\'t drain (OE — clogged pump filter)', why: 'LG won\'t spin with water in the tub. The drain pump filter behind the lower-front door clogs and stops the drain, so the machine can\'t proceed to spin. Shows as OE.', diy: 'Open the lower-front filter door, drain via the small hose or cap (pan ready), and clean the filter. Run a spin-only cycle.', difficulty: 'Moderate' },
        { name: 'Unbalanced load (UE)', why: 'A bulky single item or small load bunches up; LG stops rather than spin off-balance. Shows as UE.', diy: 'Redistribute, add towels to balance, and re-spin. Confirm the washer is level.', difficulty: 'Easy' },
        { name: 'Door not locked (dE)', why: 'A front-load LG won\'t spin unless the door lock confirms shut. A failing lock (dE) stops it.', diy: 'Ensure the door shuts fully; if it won\'t lock, the door lock assembly is the fix.', difficulty: 'Pro' },
        { name: 'Motor lock / overload (LE) or rotor bolt', why: 'LE means the motor is overloaded or jammed; rarely a loose rotor bolt lets the motor spin without the drum.', diy: 'If it\'s not drain/balance/door, a tech checks the rotor bolt and the motor (Hall sensor). LG\'s direct-drive motor is usually covered by a long warranty.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'OE', meaning: 'Not draining — clean the pump filter and check the hose' },
        { code: 'UE', meaning: 'Unbalanced load — redistribute and re-spin' },
        { code: 'dE', meaning: 'Door not locked (front-load)' },
        { code: 'LE', meaning: 'Motor locked / overloaded' },
      ],
      knownIssue: 'LG direct-drive motors are reliable and often carry a 10-year warranty, so don\'t assume the motor. Nine times out of ten an LG "won\'t spin" is a drain (OE) or balance (UE) issue — check the pump filter first.',
      forceReset: 'Clear the drain pump filter, then run Spin Only. Reset by unplugging 1 minute and confirming the door latches.',
    },
    'Whirlpool': {
      lede: 'Whirlpool top-loaders (the VMW / vertical modular washer) usually won\'t spin for one of three reasons: the lid won\'t lock, the machine can\'t drain, or the shift actuator has failed. On front-loaders it\'s the door lock, a drain clog, or the belt. Whirlpool won\'t spin with the lid unlocked or water still in the tub.',
      causes: [
        { name: 'Lid won\'t lock (F5E2) — top-load', why: 'A modern Whirlpool top-loader won\'t spin until the lid locks. A failing lid-lock assembly stops the spin and often throws F5E2.', diy: 'Listen for the lock to click at the start of a cycle. A silent or failed lock is an affordable, common part.', difficulty: 'Pro' },
        { name: 'Won\'t drain (F9E1 — clogged pump)', why: 'No drain, no spin. A clogged drain pump or hose leaves water in the tub, so the spin never starts (F9E1).', diy: 'Check the drain pump/hose for a clog (coins, socks). Clearing it often restores the spin.', difficulty: 'Moderate' },
        { name: 'Shift actuator failed (VMW)', why: 'The shift actuator switches the transmission between agitate and spin. When it fails, the washer fills and drains but won\'t spin or agitate — a signature VMW failure.', diy: 'A common, affordable tech part on VMW top-loaders when it won\'t spin AND won\'t agitate.', difficulty: 'Pro' },
        { name: 'Door lock or drive belt (front-load)', why: 'A front-load Whirlpool won\'t spin with a failed door lock, and a stretched/broken belt means the motor turns but the drum doesn\'t.', diy: 'Confirm the door locks; a motor that runs with no drum motion points to the belt.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'F5E2', meaning: 'Lid won\'t lock (top-load) — check the lid lock assembly' },
        { code: 'F9E1', meaning: 'Long drain — clogged pump or hose' },
        { code: 'F7E1', meaning: 'Motor / drive fault' },
      ],
      knownIssue: 'On Whirlpool VMW top-loaders, "won\'t spin and won\'t agitate" points straight at the shift actuator; "won\'t spin but the lid clicks" points at drain or the lid lock. Both are affordable, common parts.',
      forceReset: 'Cancel the cycle, then run Drain & Spin. Reset by unplugging 1 minute; confirm the lid locks at the start.',
    },
    'Maytag': {
      lede: 'Maytag washers are built by Whirlpool, so a Maytag that won\'t spin comes down to the same handful of causes: the lid won\'t lock, it can\'t drain, or (on the top-load Bravos/Centennial) the shift actuator or drive has failed. It won\'t spin with the lid unlocked or water still in the tub.',
      causes: [
        { name: 'Lid won\'t lock (top-load)', why: 'A modern Maytag top-loader won\'t spin until the lid locks. A failing lid-lock assembly stops the spin and often throws a lid-lock code (F5E2).', diy: 'Listen for the lock to click when a cycle starts. A silent lock is an affordable, common part.', difficulty: 'Pro' },
        { name: 'Won\'t drain (clogged pump)', why: 'No drain, no spin. A clogged drain pump or hose leaves water in the tub so the spin never starts.', diy: 'Check the drain pump and hose for a clog. Clearing it often restores the spin.', difficulty: 'Moderate' },
        { name: 'Shift actuator / drive (Bravos, Centennial)', why: 'The shift actuator switches between agitate and spin; when it fails the washer fills and drains but won\'t spin or agitate — a signature Maytag/Whirlpool top-load failure.', diy: 'A common, affordable tech part when it won\'t spin AND won\'t agitate.', difficulty: 'Pro' },
        { name: 'Door lock or belt (front-load)', why: 'A front-load Maytag won\'t spin with a failed door lock; a worn belt means the motor turns but the drum doesn\'t.', diy: 'Confirm the door locks; no drum motion with a running motor points to the belt.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'F5E2', meaning: 'Lid won\'t lock (top-load)' },
        { code: 'F9E1', meaning: 'Long drain — clogged pump or hose' },
        { code: 'Sd / Sud', meaning: 'Excess suds delaying the spin' },
      ],
      knownIssue: 'Maytag Bravos/Centennial top-loaders share Whirlpool\'s VMW platform — "won\'t spin and won\'t agitate" is the shift actuator; "won\'t spin, lid clicks" is drain or the lid lock. Affordable, common repairs.',
      forceReset: 'Run Drain & Spin. Reset by unplugging 1 minute and confirming the lid locks at cycle start.',
    },
    'GE': {
      lede: 'GE top-loaders most often won\'t spin because of the lid switch, the drain, or — on older belt-less GE models — the motor coupler or mode shifter. GE won\'t spin with the lid up or water still in the tub. The lid switch is one of the most common, cheapest fixes.',
      causes: [
        { name: 'Lid switch failed (top-load)', why: 'GE top-loaders won\'t spin if the lid switch doesn\'t confirm the lid is down. A worn lid switch is the #1 "won\'t spin" cause and a very cheap part.', diy: 'If the washer fills and agitates but won\'t spin, the lid switch is the prime suspect — an inexpensive, common fix.', difficulty: 'Moderate' },
        { name: 'Won\'t drain (clogged pump)', why: 'No drain, no spin. A clogged pump or hose leaves water in the tub so the spin never starts.', diy: 'Check the drain pump and hose for a clog and clear it.', difficulty: 'Moderate' },
        { name: 'Mode shifter / motor coupler', why: 'On many GE top-loaders a failed mode shifter (or worn motor coupler on older models) stops the spin while other functions still work.', diy: 'If the lid switch and drain are good, a tech checks the mode shifter/coupler — common, affordable parts.', difficulty: 'Pro' },
        { name: 'Door lock or belt (front-load)', why: 'A front-load GE won\'t spin with a failed door lock, and a worn belt lets the motor run without turning the drum.', diy: 'Confirm the door locks; no drum motion with a running motor points to the belt.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: '—', meaning: 'Most GE top-loaders show few spin codes; diagnose by symptom (lid switch, drain, shifter)' },
      ],
      knownIssue: 'The GE top-load lid switch is one of the cheapest, most common appliance fixes there is — if a GE fills and agitates but won\'t spin, start there before anything else.',
      forceReset: 'Confirm the lid closes fully and try a Drain & Spin. Reset by unplugging 1 minute.',
    },
  },
  'oven-not-heating': {
    'Samsung': {
      lede: 'Samsung ovens have one cause that fools almost everyone first: DEMO mode. If the oven lights up, the controls work, but it never gets hot, it\'s very often stuck in the store-display "demo" mode — a free fix. After that, an electric Samsung is usually a failed bake element or the control relay; a gas model, a weak igniter.',
      causes: [
        { name: 'Demo / display mode is ON (check this first — it\'s free)', why: 'Samsung ovens ship and sometimes reset into a store-demo mode where everything lights and beeps but the heat is disabled. This fools people into buying parts they don\'t need.', diy: 'Look for a "demo" or "d" indicator. Exit it per your model (often hold Cook Time + a second button for 3 sec, or unplug 5 min then check settings). If it heats after, that was it — no parts.', difficulty: 'Easy' },
        { name: 'Failed bake element (electric)', why: 'The lower bake element burns out — often with a visible blister or break. The oven won\'t reach temperature or won\'t heat at all.', diy: 'With the oven cool, look at the bake element for a broken/blistered spot. A visibly damaged element is a straightforward, affordable replacement.', difficulty: 'Pro' },
        { name: 'Weak igniter (gas)', why: 'On a gas Samsung the igniter glows but weakens over time until it can\'t get hot enough to open the gas valve — so it glows but never lights.', diy: 'If the igniter glows orange but no flame comes, it\'s worn out (a common, affordable gas-oven part). A tech confirms and replaces it.', difficulty: 'Pro' },
        { name: 'Control board or temperature sensor', why: 'A failed control relay won\'t power the element, and a shorted oven sensor can make the control refuse to heat.', diy: 'If demo mode is off and the element/igniter test good, a tech checks the control board and oven sensor.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'E-08 / E-27', meaning: 'Oven temperature sensor open (E-08) or shorted (E-27)' },
        { code: 'C-d0', meaning: 'Door lock stuck (won\'t heat while locked)' },
      ],
      knownIssue: 'The #1 "Samsung oven won\'t heat but everything else works" cause is DEMO mode — check it before you spend a dime. It\'s enabled far more often than people expect (a reset or a store setting can trigger it).',
      forceReset: 'Exit demo mode (hold the button combo for your model, or unplug 5 minutes and re-check settings). If that doesn\'t restore heat, unplug 5 minutes to clear a control glitch.',
    },
    'LG': {
      lede: 'On an LG oven, electric models that won\'t heat are usually a burned-out bake element or the control; gas models are almost always a weakening igniter. LG also has a display/demo mode that disables heat — worth ruling out first since it\'s free.',
      causes: [
        { name: 'Demo / display mode (check first — free)', why: 'Like Samsung, LG ovens have a demo mode that lights everything but disables the heat.', diy: 'Check for a demo indicator and exit it per your model (or unplug 5 min and re-check). If it heats after, no parts needed.', difficulty: 'Easy' },
        { name: 'Weak igniter (gas — the classic)', why: 'The gas igniter glows but degrades until it can\'t reach the temperature needed to open the safety gas valve — glows, no flame, no heat.', diy: 'Igniter glows orange but no flame = worn igniter, an affordable common gas-oven part. A tech confirms and replaces it.', difficulty: 'Pro' },
        { name: 'Failed bake element (electric)', why: 'The lower element burns out, often with a visible break or blister.', diy: 'Inspect the bake element cold for damage; a broken one is an affordable replacement.', difficulty: 'Pro' },
        { name: 'Control board or sensor', why: 'A failed control relay won\'t energize the element; a bad oven sensor can block heating.', diy: 'If demo is off and the element/igniter are good, a tech tests the control and sensor.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'F9', meaning: 'Oven not reaching temperature in time — heating circuit / sensor' },
        { code: 'F3', meaning: 'Oven temperature sensor fault' },
      ],
      knownIssue: 'LG gas igniters are a slow-fade failure — the oven takes longer and longer to heat over months, then quits. If yours has been getting slower to preheat, the igniter is almost certainly the fix.',
      forceReset: 'Exit demo mode if shown; otherwise unplug 5 minutes to clear a control glitch, then run a bake test.',
    },
    'Whirlpool': {
      lede: 'Whirlpool (and Maytag / KitchenAid) ovens that won\'t heat are usually the simplest fix in the business on electric models — a burned-out bake element you can often see. On gas models it\'s the igniter. Rule out the control lock and settings first.',
      causes: [
        { name: 'Burned-out bake element (electric — #1)', why: 'The lower bake element is the classic Whirlpool no-heat — it burns through, often with a visible blister or break, and the oven won\'t heat or won\'t reach temp.', diy: 'With the oven cool, look at the bake element for a broken/blistered spot. A visibly bad element is an affordable, common replacement.', difficulty: 'Pro' },
        { name: 'Weak igniter (gas)', why: 'The gas igniter weakens until it can\'t open the gas valve — glows but no flame.', diy: 'Igniter glows but no flame = worn igniter, a common affordable part.', difficulty: 'Pro' },
        { name: 'Control lock or wrong setting (check first)', why: 'Control lock, a timer/delay-bake set, or Sabbath mode can make it seem like the oven won\'t heat.', diy: 'Make sure control lock and Sabbath mode are off and no delayed bake is set. Free to rule out.', difficulty: 'Easy' },
        { name: 'Control board or sensor (F3E1)', why: 'A failed control relay won\'t power the element; a shorted oven sensor (F3E1) blocks heating.', diy: 'If the element/igniter and settings are good, a tech checks the control and sensor.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'F3E1', meaning: 'Oven temperature sensor open/shorted' },
        { code: 'F2E1', meaning: 'Stuck touchpad key' },
      ],
      knownIssue: 'A Whirlpool electric oven that won\'t heat is a burned-out bake element more often than anything else — and you can usually see the damage. It\'s one of the cheapest, most satisfying oven repairs there is.',
      forceReset: 'Turn off control lock / Sabbath mode and clear any delay bake, then unplug 5 minutes to clear a glitch.',
    },
    'GE': {
      lede: 'GE ovens split hard by fuel: an electric GE that won\'t heat is usually a bake element or control, but a GAS GE is famous for one thing — a weak oven igniter. It\'s one of the most common appliance failures there is.',
      causes: [
        { name: 'Weak oven igniter (gas — THE classic GE failure)', why: 'GE gas oven igniters are notorious: the igniter glows orange but degrades until it can\'t draw enough current to open the gas valve, so no flame and no heat. Extremely common.', diy: 'If the igniter glows but the burner never lights, it\'s worn out — an affordable, very common part. If it doesn\'t glow at all, still likely the igniter (or its circuit).', difficulty: 'Pro' },
        { name: 'Failed bake element (electric)', why: 'On an electric GE the bake element burns out, often visibly.', diy: 'Inspect the bake element cold for a break/blister; replace if damaged.', difficulty: 'Pro' },
        { name: 'Check the breaker (electric)', why: 'An electric oven runs on 240V (two legs). If one breaker leg trips, the oven can power the display and lights on 120V but not heat.', diy: 'Flip the double oven breaker fully off then on. If the display works but no heat, a lost 240V leg is a real possibility.', difficulty: 'Easy' },
        { name: 'Control board or sensor', why: 'A failed control relay or oven sensor can block heat once the igniter/element are ruled out.', diy: 'A tech tests the control and sensor last.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'F2 / F3', meaning: 'Oven temperature sensor or control fault' },
        { code: 'F7', meaning: 'Stuck touchpad / control key' },
      ],
      knownIssue: 'If you\'ve got a GE GAS oven that won\'t heat, bet on the igniter first — it\'s one of the single most common repairs in the whole trade. Glows but won\'t light = worn igniter, affordable fix.',
      forceReset: 'Electric: cycle the double breaker (rules out a lost 240V leg). Any model: unplug 5 minutes to clear a control glitch.',
    },
    'Frigidaire': {
      lede: 'Frigidaire (and Electrolux) ovens that won\'t heat come down to the bake element or igniter first — but Frigidaire has one extra suspect worth knowing: the electronic oven control board (EOC) is a known weak point on these, so if the heating parts test good, the control is the usual culprit.',
      causes: [
        { name: 'Failed bake element (electric)', why: 'The lower bake element burns out, often visibly, and the oven won\'t heat or reach temp.', diy: 'Inspect the bake element cold for a break/blister; a damaged one is an affordable replacement.', difficulty: 'Pro' },
        { name: 'Weak igniter (gas)', why: 'The gas igniter weakens until it can\'t open the valve — glows, no flame.', diy: 'Glows but no flame = worn igniter, a common affordable part.', difficulty: 'Pro' },
        { name: 'Electronic oven control (EOC) — known Frigidaire weak point', why: 'Frigidaire EOC boards fail more than most. A bad relay on the EOC won\'t power the element even though everything lights up.', diy: 'If the element and igniter test good, the EOC is the usual Frigidaire culprit — a tech confirms and replaces it.', difficulty: 'Pro' },
        { name: 'Oven temperature sensor (F30/F31)', why: 'An open (F30) or shorted (F31) oven sensor makes the control refuse to heat correctly.', diy: 'A tech checks the sensor resistance; out-of-range = replace it, an inexpensive part.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'F30 / F31', meaning: 'Oven temperature sensor open (F30) or shorted (F31)' },
        { code: 'F10', meaning: 'Runaway temperature — control shut the oven off' },
      ],
      knownIssue: 'Frigidaire\'s electronic oven control (EOC) board is a well-known failure point. If your Frigidaire oven won\'t heat but the bake element and igniter check out fine, the EOC is very likely the answer.',
      forceReset: 'Check the double breaker on an electric model, then unplug 5 minutes to clear a control glitch before condemning the EOC.',
    },
  },
  'dishwasher-not-cleaning': {
    'Bosch': {
      lede: 'Bosch dishwashers clean better than almost anything on the market — so when a Bosch stops cleaning, it\'s rarely the machine giving up. Nine times out of ten it\'s the fine mesh filter at the bottom that nobody knew to clean, a spray arm clogged with debris, or the water not getting hot (Bosch uses a flow-through heater, not a visible element). Rule those three out before you spend a dime.',
      causes: [
        { name: 'Clogged filter (the #1 Bosch cause — and free)', why: 'Every Bosch has a twist-out cylindrical filter in the floor of the tub. Owners often go years without cleaning it; once it packs with food and grease, dirty water just recirculates onto the dishes.', diy: 'Twist out the round filter assembly in the tub floor, rinse it under hot water with a soft brush, and clear the well underneath. Do this monthly. This alone fixes a huge share of "Bosch won\'t clean" complaints.', difficulty: 'Easy' },
        { name: 'Clogged or stuck spray arms', why: 'Hard-water scale and food plug the spray-arm jets so water can\'t reach the top rack. A stuck arm won\'t spin.', diy: 'Pull the lower (and middle) spray arms off, poke each jet clear with a toothpick, rinse, and make sure they spin freely by hand before reseating.', difficulty: 'Easy' },
        { name: 'Water not heating (flow-through heater / NTC sensor)', why: 'Bosch heats water as it circulates. If the flow-through heater or its NTC temperature sensor fails, the wash runs cold and won\'t dissolve detergent or cut grease.', diy: 'If dishes come out gritty and the tub is cold at the end, suspect the heater circuit — a technician diagnosis. Also run the hot tap at the sink before starting so the fill is hot.', difficulty: 'Pro' },
        { name: 'Circulation pump weak or blocked', why: 'If the filter is clean and arms are clear but pressure is still weak, the wash (circulation) pump may be failing or have debris in the impeller.', diy: 'After clearing the filter, if cleaning is still poor, a tech checks the circulation pump.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'E22', meaning: 'Filter clogged — clean the tub filter' },
        { code: 'E24', meaning: 'Water not draining — clogged filter, hose, or drain pump' },
        { code: 'E09', meaning: 'Heating element / flow-through heater fault (cold wash)' },
        { code: 'E15', meaning: 'Water in the base pan — AquaStop leak protection tripped' },
      ],
      knownIssue: 'The single most common "my Bosch stopped cleaning" fix is cleaning the tub filter — most owners never knew it existed. Pull it, rinse it, do it monthly, and cleaning performance usually snaps right back with no parts at all.',
      forceReset: 'Cancel/drain a stuck cycle by pressing and holding the Start button (or the button marked with the drain symbol) for about 3–4 seconds. To clear a control glitch, trip the dishwasher\'s breaker for a minute.',
    },
    'Whirlpool': {
      lede: 'A Whirlpool dishwasher that runs but leaves dishes dirty is almost always one of three things: the chopper/food-grinder area or filter is clogged, a spray arm is blocked, or the water inlet valve is weak so the tub never fills enough to wash. Whirlpool builds these simple — most of it you can check yourself.',
      causes: [
        { name: 'Clogged filter or food chopper', why: 'Newer Whirlpools have a bottom filter that clogs; older ones use a chopper/grinder that can jam with a chip of glass or a fruit pit, so food redeposits on the dishes.', diy: 'Remove the lower rack, twist out the filter (if equipped), rinse it, and clear the sump area of any debris. Run the hot tap at the sink before starting.', difficulty: 'Easy' },
        { name: 'Blocked spray arms', why: 'Jets clog with scale and food so upper dishes never get sprayed.', diy: 'Pull the spray arms and clear every jet with a toothpick; confirm they spin freely.', difficulty: 'Easy' },
        { name: 'Weak water inlet valve', why: 'If the tub barely fills, there\'s not enough water to clean. A failing inlet valve or a kinked/clogged supply is the usual cause.', diy: 'Listen for a proper fill. If it sounds like very little water enters, the inlet valve is a common, affordable part (a tech replaces it).', difficulty: 'Pro' },
        { name: 'Wash pump / motor', why: 'If the filter and arms are clear and it still won\'t clean, the wash pump may not be building pressure.', diy: 'A technician checks the wash-pump motor last, after the cheap causes are ruled out.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'Many Whirlpool dishwashers signal a fault by blinking the Clean light in a pattern rather than showing a code. If your Clean light is flashing, count the blinks — the pattern maps to a specific fault (often heating or a stuck relay) and tells the tech exactly where to look.',
      forceReset: 'Reset by pressing Cancel (or hold the cycle buttons your model uses) to drain, then cut power at the breaker for a minute. On top-control models a Start/Cancel hold clears a stuck cycle.',
    },
    'KitchenAid': {
      lede: 'KitchenAid dishwashers are Whirlpool\'s premium line — third rack, quieter, stronger wash — so when one stops cleaning it\'s worth fixing. The usual suspects are the same trio: a clogged filter or chopper in the sump, blocked spray arms (especially the third-rack feed), or a water-heating problem leaving the wash too cold to cut grease.',
      causes: [
        { name: 'Clogged filter / sump debris', why: 'Food and grease pack the filter and sump so dirty water recirculates. Glass chips can jam the chopper.', diy: 'Twist out and rinse the filter, clear the sump. Do it monthly. Run hot water at the sink first so the wash starts hot.', difficulty: 'Easy' },
        { name: 'Blocked spray arms (incl. third-rack feed)', why: 'The upper and third-rack arms clog with scale so the top dishes come out dirty.', diy: 'Remove each spray arm, clear the jets, confirm free spin, and check the third-rack water feed tube is seated.', difficulty: 'Easy' },
        { name: 'Water not heating', why: 'If the wash runs cold, detergent won\'t dissolve and grease won\'t clear. The heater circuit or its sensor may have failed.', diy: 'Cold tub at cycle-end with gritty dishes points to the heater — a technician diagnosis.', difficulty: 'Pro' },
        { name: 'Weak circulation / wash pump', why: 'After the filter and arms are clean, low spray pressure points to the wash pump.', diy: 'A tech checks the circulation pump if the cheap fixes don\'t restore cleaning.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'Like other Whirlpool-family dishwashers, KitchenAid often flashes the Clean light in a pattern instead of a code. Count the flashes — the pattern identifies the fault (frequently a heater or thermistor issue on premium models) so the repair goes straight to the cause.',
      forceReset: 'Hold Start/Cancel to drain a stuck cycle, then pull power at the breaker for a minute to clear the control.',
    },
    'Samsung': {
      lede: 'A Samsung dishwasher that isn\'t cleaning usually comes down to a clogged sump/filter, a spray arm that isn\'t spinning, or a fill/drain problem so the tub doesn\'t hold enough clean water. Samsung dishwashers also throw clear error codes — an OE, 5C, or LC on the panel points you straight at the cause.',
      causes: [
        { name: 'Clogged filter and sump', why: 'The bottom filter and sump pack with food so dirty water recirculates onto the dishes.', diy: 'Twist out the filter under the lower spray arm, rinse it and the sump, and clear any debris. Run monthly.', difficulty: 'Easy' },
        { name: 'Spray arm not spinning / clogged', why: 'Scale and food block the jets or wedge the arm so upper dishes stay dirty.', diy: 'Pull the spray arms, clear each jet, confirm they spin freely, and reseat firmly.', difficulty: 'Easy' },
        { name: 'Drain problem leaving dirty water (OE/5C)', why: 'If the dishwasher can\'t drain fully, it washes the next cycle in dirty water. An OE or 5C code means a clogged filter, drain hose, or drain pump.', diy: 'Clean the filter, check the drain hose for kinks, and make sure the sink air gap / disposal knockout is clear.', difficulty: 'Moderate' },
        { name: 'Water not heating / weak fill', why: 'A failed heater or a weak water-supply fill (4C) means cold or too-little water — poor cleaning.', diy: 'Confirm the hot supply valve is fully open and the inlet screen is clear; a cold end-of-cycle tub points to the heater (a tech job).', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'OE / 5C', meaning: 'Drainage error — clogged filter, hose, or drain pump (washes in dirty water)' },
        { code: '4C', meaning: 'Water supply error — closed valve, kinked line, or clogged inlet screen' },
        { code: 'LC / LE', meaning: 'Leak detected — leak sensor tripped' },
        { code: 'tC', meaning: 'Temperature sensor fault (heating/cleaning affected)' },
      ],
      knownIssue: 'Samsung dishwashers are prone to sump and drain clogs, and a machine that doesn\'t drain fully will "wash" the next load in leftover dirty water — the top complaint behind "it stopped cleaning." Clean the filter and clear the drain path first; an OE or 5C code confirms it.',
      forceReset: 'Reset by holding the cycle buttons your model uses (often two adjacent buttons for ~3 seconds) or by cutting power at the breaker for a minute to clear the control.',
    },
    'LG': {
      lede: 'On an LG dishwasher, "runs but won\'t clean" is usually a clogged filter, a spray arm that isn\'t turning, or a fill/heat problem. LG\'s direct-drive wash motor is strong, so weak cleaning is far more often a clog or a cold wash than a dead motor — and LG shows a clear code (OE, IE, tE) that tells you which.',
      causes: [
        { name: 'Clogged filter / inlet screen', why: 'The bottom filter clogs with food, and the water-inlet screen scales up so the tub underfills — both leave dishes dirty.', diy: 'Twist out and rinse the tub filter; if fill seems weak, close the supply and clean the inlet screen at the valve. Run hot water at the sink first.', difficulty: 'Easy' },
        { name: 'Spray arm not spinning (nE)', why: 'A blocked or jammed spray arm — or the vario/spray motor fault (nE) — means water never reaches the upper rack.', diy: 'Clear the spray-arm jets and confirm free spin. A persistent nE code is a technician check.', difficulty: 'Moderate' },
        { name: 'Not draining fully (OE)', why: 'An OE drain error means the machine holds dirty water and re-washes in it.', diy: 'Clean the filter, check the drain hose and the disposal/air-gap for a clog.', difficulty: 'Moderate' },
        { name: 'Water not heating (tE)', why: 'LG heats the wash inline; a heater or temp-sensor fault (tE) runs the cycle cold so detergent and grease don\'t clear.', diy: 'A cold tub at cycle-end or a tE code points to the heater circuit — a tech job.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'OE', meaning: 'Drain error — clogged filter, hose, or drain pump' },
        { code: 'IE', meaning: 'Inlet/fill error — supply valve, kink, or clogged inlet screen' },
        { code: 'nE', meaning: 'Spray (vario) motor fault' },
        { code: 'tE', meaning: 'Heater / temperature sensor fault (cold wash)' },
      ],
      knownIssue: 'LG\'s wash motor rarely dies, so on an LG a cleaning problem is almost always a clog (filter or inlet screen) or a cold wash (tE) — check those before assuming anything expensive. The on-screen code narrows it in seconds.',
      forceReset: 'Press Power, then hold the button combination your model uses (often Delay/Start held ~3 seconds), or cut power at the breaker for a minute to clear a control glitch.',
    },
    'GE': {
      lede: 'A GE dishwasher that leaves dishes dirty is usually a clogged filter or chopper, a blocked spray arm, or a weak water inlet valve so the tub never fills right. GE\'s newer models have a bottom filter you can clean; older ones use a hard-food disposer with a chopper blade. Both are checkable at home.',
      causes: [
        { name: 'Clogged filter or food chopper', why: 'Newer GE dishwashers use a filter that clogs; older ones grind food with a chopper that can jam, redepositing debris on dishes.', diy: 'Remove the lower rack and lower spray arm, twist out and rinse the filter (if equipped), and clear the sump. Run the hot tap first.', difficulty: 'Easy' },
        { name: 'Blocked spray arms', why: 'Scale and food plug the jets so water can\'t reach the upper rack.', diy: 'Pull the spray arms, clear each jet, and confirm free spin.', difficulty: 'Easy' },
        { name: 'Weak water inlet valve / low fill', why: 'If the tub barely fills, there isn\'t enough water to wash. A tired inlet valve or clogged inlet screen is the usual cause.', diy: 'Confirm the hot supply is fully open; if fill is weak, the inlet valve is a common affordable part (tech replaces it).', difficulty: 'Pro' },
        { name: 'Wash motor / pump', why: 'With the filter and arms clear, low spray pressure points to the wash pump.', diy: 'A technician checks the wash-pump motor after the cheap causes are ruled out.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'On older GE dishwashers with a hard-food disposer, a small piece of glass or a fruit pit can jam the chopper so food gets ground and sprayed back onto the dishes instead of drained. Clearing the sump/chopper is a common, no-parts fix.',
      forceReset: 'Reset by pressing Start/Reset and letting it drain, then cut power at the breaker for a minute. Some GE models reset by turning the breaker off for 30 seconds.',
    },
    'Frigidaire': {
      lede: 'A Frigidaire dishwasher that won\'t clean is most often a clogged filter or spray arm, or water that isn\'t hot enough to dissolve detergent. Frigidaire dishwashers are straightforward — the cheap, checkable causes fix the large majority of "it stopped cleaning" cases.',
      causes: [
        { name: 'Clogged filter and sump', why: 'The bottom filter and sump pack with food and grease so dirty water recirculates.', diy: 'Twist out and rinse the filter under hot water, clear the sump, and run it monthly. Run the sink\'s hot tap before starting.', difficulty: 'Easy' },
        { name: 'Blocked spray arms', why: 'Clogged jets or a stuck arm leave the top rack dirty.', diy: 'Pull the spray arms, clear each jet with a toothpick, and confirm they spin freely.', difficulty: 'Easy' },
        { name: 'Water not hot enough', why: 'Frigidaire relies heavily on incoming hot water plus a heater; a cold fill or failed heater leaves grease and detergent behind.', diy: 'Run the kitchen hot tap until it\'s hot, then start the dishwasher. If the tub is cold at cycle-end, the heater circuit needs a tech.', difficulty: 'Moderate' },
        { name: 'Weak inlet valve / wash pump', why: 'Low fill (inlet valve) or low spray pressure (wash pump) both leave dishes dirty after the cheap causes are ruled out.', diy: 'A technician checks the inlet valve and wash pump last.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'Frigidaire dishwashers depend a lot on genuinely hot incoming water. If yours cleans poorly, run the kitchen hot tap until it runs hot BEFORE starting the cycle — a surprising number of "won\'t clean" Frigidaires are just being fed cold water at the start.',
      forceReset: 'Cancel/drain by pressing the Cancel button (dishes may need to be restarted), then cut power at the breaker for a minute to clear the control.',
    },
    'Maytag': {
      lede: 'Maytag dishwashers are built on the Whirlpool platform, so a Maytag that runs but leaves dishes dirty comes down to the same trio: a clogged filter or chopper in the sump, blocked spray arms, or a weak fill/heat so there\'s not enough hot water to wash. All three are checkable before you call anyone.',
      causes: [
        { name: 'Clogged filter or chopper', why: 'Food packs the filter (newer models) or jams the chopper (older ones), so debris recirculates onto the dishes.', diy: 'Twist out and rinse the filter, clear the sump of any debris, and run the sink\'s hot tap before starting.', difficulty: 'Easy' },
        { name: 'Blocked spray arms', why: 'Scale and food clog the jets so the upper rack never gets sprayed.', diy: 'Remove the spray arms, clear each jet, and confirm they spin freely.', difficulty: 'Easy' },
        { name: 'Weak water inlet / low fill', why: 'If the tub underfills, there isn\'t enough water to clean — usually a tired inlet valve or clogged inlet screen.', diy: 'Confirm the hot supply is fully open; a weak fill points to the inlet valve (a tech replaces it).', difficulty: 'Pro' },
        { name: 'Wash pump / heating', why: 'After the filter and arms are clear, low pressure (wash pump) or a cold wash (heater) is the remaining cause.', diy: 'A technician checks the wash pump and heater last.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'Like its Whirlpool siblings, a Maytag dishwasher often signals a fault by flashing the Clean light in a pattern instead of a code. If the Clean light is blinking, count the flashes — the pattern points straight at the fault so the fix isn\'t a guess.',
      forceReset: 'Hold Start/Cancel to drain a stuck cycle, then cut power at the breaker for a minute to clear the control.',
    },
  },
  'refrigerator-making-noise': {
    'Samsung': {
      lede: 'The classic Samsung refrigerator noise is a loud buzzing, humming, or knocking from the back — and on French-door RF models it\'s almost always the evaporator fan hitting ICE. When the defrost system can\'t keep up, ice builds around the fan blade behind the rear freezer panel; the blade clips it and you get a rattle or buzz that comes and goes, usually loudest after the doors have been open a lot. It\'s a defrost problem showing up as noise.',
      causes: [
        { name: 'Evaporator fan hitting ice (the classic Samsung noise)', why: 'On RF/RS models a defrost sensor or heater fault lets frost build around the evap fan behind the back freezer panel; the blade strikes the ice and buzzes, rattles, or grinds — often worse after heavy door use.', diy: 'Run a Force Defrost (below) or empty the freezer and unplug 24–48 hrs to melt the ice. If the noise stops then returns in a few days, the defrost part needs replacing — a tech job.', difficulty: 'Moderate' },
        { name: 'Ice maker cycling', why: 'Samsung ice makers click, whir, and drop ice on a cycle — normal — but a frosted-up ice maker can grind or clunk harder than it should.', diy: 'If the noise is a periodic click/drop from the ice-maker area, that\'s largely normal. Persistent grinding points to ice-maker frosting (a known Samsung issue).', difficulty: 'Easy' },
        { name: 'Condenser fan (debris or dust)', why: 'A humming or rattling low at the back can be the condenser fan clogged with dust or something caught in the blade.', diy: 'Unplug, pull the fridge out, and vacuum the condenser area at the lower back. Free and safe.', difficulty: 'Easy' },
        { name: 'Compressor / inverter noise', why: 'A steady hum is normal; loud rattling or a repeated click-and-stop can be the compressor or inverter board.', diy: 'If both compartments are also warming with the noise, have a tech check the compressor/inverter.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'The Samsung RF French-door evaporator-fan-icing noise is one of the most-reported complaints on these fridges — a buzzing or knocking from the upper back that a Force Defrost temporarily silences. If yours does exactly that, the root fix is the defrost repair, and it\'s a common, worthwhile one.',
      forceReset: 'Force Defrost: with the doors open, press and hold Freezer + Fridge (or Energy Saver + Fridge on some models) for ~8 seconds until the display blanks, then press until you see "Fd." This melts the ice off the evap fan — if the noise stops, you\'ve found it.',
    },
    'LG': {
      lede: 'An LG refrigerator has a normal gentle hum from its linear compressor, so a NEW loud noise usually means something else: a rattling or humming at the lower back is typically the condenser fan (dust or debris), a buzzing from behind the freezer panel is the evaporator fan icing up, and a repeated click-and-stop can be the linear compressor itself — which carries a 10-year warranty.',
      causes: [
        { name: 'Condenser fan (dust/debris)', why: 'A rattle or loud hum low at the back is often the condenser fan clogged with dust or catching on debris.', diy: 'Unplug, pull the fridge out, and vacuum the condenser coils and fan at the lower back. Free, safe, and a common fix.', difficulty: 'Easy' },
        { name: 'Evaporator fan icing (buzz from the freezer)', why: 'A buzzing or ticking from behind the back freezer panel is the evap fan clipping frost when defrost falls behind.', diy: 'Empty the freezer and unplug 24–48 hrs to melt the ice; if the buzz returns in days, the defrost part needs replacing.', difficulty: 'Moderate' },
        { name: 'Linear compressor clicking (known LG issue)', why: 'A repeated click-then-silence with the fridge warming points at the linear compressor or its inverter — LG\'s well-documented failure.', diy: 'Check your model/serial against LG\'s 10-year compressor warranty and the settlement; diagnosis and replacement are a tech job.', difficulty: 'Pro' },
        { name: 'Ice maker cycling', why: 'Periodic whirring and ice dropping is normal; harder grinding can mean a frosted ice maker.', diy: 'Occasional clicks/drops are normal. Constant grinding is worth a tech look.', difficulty: 'Easy' },
      ],
      faultCodes: [],
      knownIssue: 'On an LG, a normal fridge purrs quietly — so a loud NEW hum or rattle is most often just the condenser fan needing a vacuum, an easy free fix. But a repeated click-and-stop with warming is the linear-compressor signature, which is frequently covered under LG\'s 10-year compressor warranty.',
      forceReset: 'Unplug for 5 minutes to clear a control glitch. For a suspected evap-fan-ice buzz, unplug 24–48 hrs with the freezer emptied to melt the ice and confirm the source.',
    },
    'Whirlpool': {
      lede: 'A Whirlpool refrigerator (and Maytag/KitchenAid) making noise usually traces to one of the two fans or the ice maker: a loud hum or rattle at the lower back is the condenser fan (often just dust or debris), a chirping or squealing from behind the freezer panel is the evaporator fan, and periodic clunks are the ice maker. Most are cheap, checkable causes.',
      causes: [
        { name: 'Condenser fan (dust/debris) — start here', why: 'A humming, rattling, or buzzing low at the back is commonly the condenser fan clogged with dust or catching on debris or the drain pan.', diy: 'Unplug, pull the fridge out, and vacuum the condenser coils and fan at the bottom/back. Free, safe, and the most common fix.', difficulty: 'Easy' },
        { name: 'Evaporator fan squeal/chirp', why: 'A chirping or squealing from behind the rear freezer panel is a worn evap fan motor or one clipping frost from a defrost issue.', diy: 'If it\'s a squeal, the evap fan motor is a known wear part; if it\'s a buzz that a defrost cycle stops, it\'s frost on the blade.', difficulty: 'Pro' },
        { name: 'Ice maker cycling', why: 'Periodic clunks and water-fill sounds from the ice maker are normal; constant grinding is not.', diy: 'Occasional clunks are normal. If it grinds continuously, shut the ice maker off and have it checked.', difficulty: 'Easy' },
        { name: 'Compressor hum', why: 'A steady low hum is normal operation; loud knocking is rare and points at the compressor.', diy: 'If a loud knock comes with warming, have a tech check the compressor.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'On Whirlpool-family fridges the #1 noise fix is the cheapest one: vacuuming the condenser fan and coils at the back. Dust and pet hair pack the blade and make it hum or rattle — clean it and the noise very often just goes away, no parts needed.',
      forceReset: 'Unplug for 5 minutes to clear a control glitch. For a fan-ice buzz, empty the freezer and unplug 24–48 hrs to melt the frost and confirm the source.',
    },
    'GE': {
      lede: 'A GE refrigerator making noise is most often a fan: a loud hum or rattle at the lower back is the condenser fan (dust or debris), and a buzzing or knocking from behind the freezer panel — common on GE bottom-freezer models — is the evaporator fan clipping ice when defrost falls behind. The ice maker and compressor round out the usual suspects.',
      causes: [
        { name: 'Condenser fan (dust/debris)', why: 'A rattling hum low at the back is usually the condenser fan clogged with dust or catching on the drain pan or debris.', diy: 'Unplug, pull the fridge out, vacuum the condenser coils and fan at the bottom/back. Free and safe.', difficulty: 'Easy' },
        { name: 'Evaporator fan icing (GE bottom-freezer)', why: 'GE bottom-freezer models are known for a buzzing/knocking evap fan when frost builds behind the rear panel from a defrost fault.', diy: 'Empty the freezer and unplug 24–48 hrs to melt the ice; if the noise returns in days, the defrost part or fan needs replacing.', difficulty: 'Moderate' },
        { name: 'Ice maker cycling', why: 'Periodic fill and drop sounds are normal; a frosted or failing ice maker grinds.', diy: 'Occasional clicks are normal; constant grinding warrants a look.', difficulty: 'Easy' },
        { name: 'Compressor', why: 'A steady hum is normal; loud knocking points at the compressor.', diy: 'Loud knocking with warming = have a tech check the compressor.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'GE bottom-freezer refrigerators have a well-known evaporator-fan-icing noise — a buzz or knock from the back that a full 24–48 hour defrost silences temporarily. If that describes yours, the fix is the defrost/fan repair; if the noise is at the very bottom-back instead, start with a free condenser-fan cleaning.',
      forceReset: 'Unplug for 5 minutes to clear a control glitch; for a suspected fan-ice buzz, empty the freezer and unplug 24–48 hrs to melt the frost.',
    },
    'Frigidaire': {
      lede: 'A Frigidaire (or Electrolux) refrigerator making noise usually comes down to the condenser fan, the evaporator fan, or the ice maker. A loud hum or rattle at the lower back is typically the condenser fan clogged with dust; a buzzing from behind the freezer panel on side-by-sides is the evap fan clipping ice from a defrost issue. Both start with simple checks.',
      causes: [
        { name: 'Condenser fan (dust/debris) — check first', why: 'A humming or rattling low at the back is most often the condenser fan packed with dust or catching debris.', diy: 'Unplug, pull the fridge out, and vacuum the condenser coils and fan at the bottom/back. Free, safe, and the most common cause.', difficulty: 'Easy' },
        { name: 'Evaporator fan icing (side-by-side)', why: 'A buzzing or knocking from behind the freezer wall is the evap fan hitting frost when the defrost system falls behind.', diy: 'Empty the freezer and unplug 24–48 hrs to melt the ice; if the noise returns in days, the defrost part or fan needs replacing.', difficulty: 'Moderate' },
        { name: 'Ice maker cycling', why: 'Periodic fill/drop sounds are normal; continuous grinding is not.', diy: 'Occasional clicks are normal; shut the ice maker off if it grinds nonstop and have it checked.', difficulty: 'Easy' },
        { name: 'Compressor', why: 'A steady hum is normal operation; loud knocking is rare and points at the compressor.', diy: 'Loud knocking with warming = a tech checks the compressor.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'On a Frigidaire the most common noise fix is free: vacuum the condenser fan and coils at the lower back. They pack with dust and pet hair and start to hum or rattle — cleaning them out quiets most Frigidaires without any parts.',
      forceReset: 'Unplug for 5 minutes to clear a control glitch; for a fan-ice buzz, empty the freezer and unplug 24–48 hrs to melt the frost and confirm the source.',
    },
  },
  'dryer-wont-start': {
    'Samsung': {
      lede: 'A Samsung dryer that won\'t start is most often one of three quick things before any real part: the door isn\'t latched hard enough for the switch to register, Child Lock is on, or the Start button needs a firm press-and-hold. If those are clear, the usual part is a blown thermal fuse — and on a Samsung that almost always means the vent is clogged and the dryer overheated.',
      causes: [
        { name: 'Door not fully latched (check first)', why: 'Samsung dryer doors need a firm push to trip the door switch; if the switch doesn\'t see the door closed, the dryer stays dead.', diy: 'Open and close the door firmly and listen for the click, then try Start. A door that feels loose or a worn strike is a common, cheap fix.', difficulty: 'Easy' },
        { name: 'Child Lock is on', why: 'Child Lock (a key/lock icon) disables the controls so the dryer won\'t respond or start.', diy: 'Look for a lock icon on the display. Press and hold the Child Lock button (often ~3 seconds) to clear it, then start.', difficulty: 'Easy' },
        { name: 'Blown thermal fuse (usually a clogged vent)', why: 'When the exhaust vent clogs, the dryer overheats and the thermal fuse blows to protect it — on many Samsung models that cuts the motor so it won\'t start at all.', diy: 'Clean the full vent line first (a clogged vent is the root cause). The blown fuse itself is an affordable part a tech replaces — and if you don\'t clear the vent, the new one blows again.', difficulty: 'Pro' },
        { name: 'Start button / control', why: 'A worn Start button or the main control can stop the dryer from responding.', diy: 'If door, Child Lock, and vent are all good and it still won\'t start, a tech checks the start circuit and control.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'dE / dC', meaning: 'Door not sensed closed — latch, door switch, or strike' },
      ],
      knownIssue: 'On Samsung dryers, "won\'t start" is a loose door or Child Lock far more often than a real failure — check both before anything. When it IS a part, a thermal fuse blown from a clogged vent is the classic cause; always clean the vent or the replacement fuse will blow again.',
      forceReset: 'Clear Child Lock (hold the lock button ~3 sec), close the door firmly, and hold Start. To clear a control glitch, unplug the dryer for 5 minutes.',
    },
    'LG': {
      lede: 'An LG dryer that won\'t start usually comes down to the door not latching, the Child Lock being on, or needing a firm press-and-hold on Start — then a blown thermal fuse from a clogged vent. LG door alignment is a common culprit: if the door feels like it doesn\'t seat squarely, the switch may not register.',
      causes: [
        { name: 'Door not latched / misaligned (check first)', why: 'LG dryer doors can sag or not seat square, so the door switch never registers "closed" and the dryer stays dead.', diy: 'Close the door firmly and listen for the click; if it feels loose or crooked, the latch/switch is a common fix.', difficulty: 'Easy' },
        { name: 'Child Lock is on', why: 'Child Lock disables the controls; the dryer ignores Start.', diy: 'Look for the lock icon and hold the Child Lock button (~3 sec) to clear it.', difficulty: 'Easy' },
        { name: 'Blown thermal fuse (clogged vent)', why: 'A clogged exhaust vent overheats the dryer and blows the thermal fuse; on many LG models that stops the dryer from starting.', diy: 'Clean the entire vent line — that\'s the real cause. The fuse is an affordable part, but it re-blows if the vent isn\'t cleared.', difficulty: 'Pro' },
        { name: 'Start switch / control', why: 'A worn Start button or main control board can stop it responding.', diy: 'If door, Child Lock, and vent are good, a tech checks the start circuit and control.', difficulty: 'Pro' },
      ],
      faultCodes: [
        { code: 'dE', meaning: 'Door not sensed closed — latch, door switch, or alignment' },
      ],
      knownIssue: 'LG dryer "won\'t start" complaints are very often just a door that isn\'t seating square or Child Lock left on — both free to rule out. If it\'s a part, a thermal fuse blown by a clogged vent is the usual one, so clean the vent as part of the repair.',
      forceReset: 'Clear Child Lock (hold the lock button ~3 sec), shut the door firmly, hold Start. Unplug 5 minutes to clear a control glitch.',
    },
    'Whirlpool': {
      lede: 'A Whirlpool dryer (and Maytag/KitchenAid) that won\'t start has one classic cause above all: the door switch. Whirlpool door switches are a well-known wear point — when it fails you press Start and get nothing (or just a hum). After that it\'s the thermal fuse, the start switch, or Control Lock.',
      causes: [
        { name: 'Failed door switch (the classic Whirlpool cause)', why: 'The door switch tells the dryer the door is closed. On Whirlpool-family dryers it\'s a common failure — a bad one means Start does nothing even with the door shut.', diy: 'Open and close the door firmly and listen for the switch click. No click, or "won\'t start with the door clearly shut," points right at the door switch — an affordable, common part.', difficulty: 'Moderate' },
        { name: 'Blown thermal fuse (clogged vent)', why: 'A clogged vent overheats the dryer and blows the thermal fuse; on Whirlpool models a blown fuse commonly kills the motor so it won\'t start.', diy: 'Clean the full vent line (the root cause). The fuse is a cheap part, but it re-blows if the vent stays clogged.', difficulty: 'Pro' },
        { name: 'Control Lock is on', why: 'Control Lock (a lock icon) disables the buttons.', diy: 'Hold the Control Lock button (~3 sec) to clear the lock, then start.', difficulty: 'Easy' },
        { name: 'Start switch or belt switch', why: 'A worn push-to-start switch, or the broken-belt switch, will stop the dryer from starting.', diy: 'If the door switch, fuse, and lock are all good, a tech checks the start switch and belt switch.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'On a Whirlpool, Maytag, or KitchenAid dryer that won\'t start, bet on the door switch first — it\'s one of the most common failures in the whole dryer line. Press Start and get nothing with the door clearly shut? That\'s the door switch until proven otherwise, and it\'s an affordable fix.',
      forceReset: 'Clear Control Lock (hold the lock button ~3 sec), close the door hard enough to click, and hold Start. Unplug 5 minutes to clear a control glitch.',
    },
    'GE': {
      lede: 'A GE dryer that won\'t start is usually the door switch, a worn push-to-start switch, or a blown thermal fuse from a clogged vent. GE push-to-start switches wear out with use — you press Start and the dryer does nothing or only hums. Control Lock is worth ruling out first since it\'s free.',
      causes: [
        { name: 'Control Lock on (check first)', why: 'Control Lock disables the buttons so nothing responds.', diy: 'Look for a lock icon and hold the lock button (~3 sec) to clear it.', difficulty: 'Easy' },
        { name: 'Failed door switch', why: 'If the door switch doesn\'t register the door as closed, the dryer won\'t start.', diy: 'Close the door firmly and listen for the click; no click points at the door switch — a common, affordable part.', difficulty: 'Moderate' },
        { name: 'Worn push-to-start switch', why: 'GE start switches wear with use; a bad one means Start does nothing even with the door shut and lock off.', diy: 'If the door and lock are good but Start is dead, the start switch is the usual GE culprit — a tech replaces it.', difficulty: 'Pro' },
        { name: 'Blown thermal fuse (clogged vent)', why: 'A clogged vent overheats the dryer and blows the thermal fuse, which can stop it starting on many models.', diy: 'Clean the full vent line; the fuse is a cheap part but re-blows if the vent stays clogged.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'On GE dryers a dead Start button with the door clearly shut is often the push-to-start switch wearing out — one of the more common GE dryer repairs. Rule out Control Lock and the door switch first, then it\'s the start switch.',
      forceReset: 'Clear Control Lock (hold the lock button ~3 sec), close the door firmly, and hold Start. Unplug 5 minutes to clear a control glitch.',
    },
    'Frigidaire': {
      lede: 'A Frigidaire (or Electrolux) dryer that won\'t start is most often the door switch, a worn start switch, or a blown thermal fuse from a clogged vent. Start with the free checks — door latched firmly and Control Lock off — before assuming a part.',
      causes: [
        { name: 'Door not latched / door switch (check first)', why: 'If the door switch doesn\'t sense the door closed, the dryer won\'t start.', diy: 'Close the door firmly and listen for the click; a loose door or no click points at the latch/door switch.', difficulty: 'Moderate' },
        { name: 'Control Lock is on', why: 'Control Lock disables the buttons.', diy: 'Hold the lock button (~3 sec) to clear it, then start.', difficulty: 'Easy' },
        { name: 'Blown thermal fuse (clogged vent)', why: 'A clogged vent overheats the dryer and blows the thermal fuse, which can cut the motor so it won\'t start.', diy: 'Clean the entire vent line (the root cause); the fuse is an affordable part but re-blows if the vent stays clogged.', difficulty: 'Pro' },
        { name: 'Start switch / control', why: 'A worn push-to-start switch or the main control can stop it responding.', diy: 'If door, lock, and vent are all good, a tech checks the start switch and control.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'A Frigidaire dryer that hums or does nothing when you press Start — with the door clearly shut and Control Lock off — is usually the door switch or start switch, both affordable parts. And any "won\'t start" tied to overheating means a clogged vent blew the thermal fuse: clean the vent or it happens again.',
      forceReset: 'Clear Control Lock (hold the lock button ~3 sec), shut the door firmly, and hold Start. Unplug 5 minutes to clear a control glitch.',
    },
    'Maytag': {
      lede: 'Maytag dryers are built on the Whirlpool platform, so a Maytag that won\'t start points at the same classic cause first: the door switch. A worn door switch means Start does nothing even with the door shut. After that it\'s the thermal fuse (clogged vent), Control Lock, or the start switch.',
      causes: [
        { name: 'Failed door switch (the classic cause)', why: 'The door switch is a well-known Whirlpool-family wear point; a bad one leaves the dryer dead when you press Start.', diy: 'Close the door firmly and listen for the click. No click, or dead Start with the door clearly shut, points right at the door switch — an affordable, common part.', difficulty: 'Moderate' },
        { name: 'Control Lock is on', why: 'Control Lock disables the buttons.', diy: 'Hold the lock button (~3 sec) to clear it, then start.', difficulty: 'Easy' },
        { name: 'Blown thermal fuse (clogged vent)', why: 'A clogged vent overheats the dryer and blows the thermal fuse, which commonly stops the motor from starting.', diy: 'Clean the full vent line; the fuse is a cheap part but re-blows if the vent stays clogged.', difficulty: 'Pro' },
        { name: 'Start switch or belt switch', why: 'A worn push-to-start switch or the broken-belt switch will stop it starting.', diy: 'If the door switch, fuse, and lock are good, a tech checks the start and belt switches.', difficulty: 'Pro' },
      ],
      faultCodes: [],
      knownIssue: 'Like its Whirlpool siblings, a Maytag dryer that won\'t start is a failed door switch more often than anything — press Start, get nothing, door clearly shut = door switch until proven otherwise. It\'s an affordable, satisfying fix.',
      forceReset: 'Clear Control Lock (hold the lock button ~3 sec), close the door firmly, and hold Start. Unplug 5 minutes to clear a control glitch.',
    },
  },
};
