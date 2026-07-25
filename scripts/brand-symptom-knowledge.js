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
};
