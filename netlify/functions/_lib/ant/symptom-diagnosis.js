// symptom-diagnosis.js — the DIAGNOSTIC brain (Teddy 2026-08-21: "aim it at the
// diagnosis and symptoms").
//
// Our repair history never recorded which PART fixed each job (archive = dispatch +
// fees; live TDRs = mostly blank/prose), so predicting an exact SKU from history is
// ~1% and always will be. What we CAN nail is the DIAGNOSIS — what's failing and where
// to look — because that's real appliance-repair cause-and-effect, accurate WITHOUT
// needing volume. This file encodes that: per appliance, an ordered list of symptom
// patterns → the likely failed components (most-first) with the CONFIRMING test and the
// part CATEGORY to look up. The exact part number is then a catalog lookup off
// (model + component), not a guess.
//
// Grounding: diagnose() will BOOST a component when the shop's own history for that
// model/brand shows it failing — history refines the ranking, the knowledge base makes
// it right on the first one we've never seen. Safety-flag gas / 240V / sealed-system.
'use strict';

// Canonical appliance from any text (field OR free symptom).
function canonAppliance(s) {
  const t = String(s || '').toLowerCase();
  if (/(refriger|fridge|freezer|ice ?maker|evapor|condenser|not cooling|won'?t cool|cooling)/.test(t)) return 'refrigerator';
  if (/(dishwash)/.test(t)) return 'dishwasher';
  if (/(\bdryer\b|not drying|won'?t dry)/.test(t)) return 'dryer';
  if (/(washer|washing machine|won'?t spin|won'?t drain|won'?t agitate)/.test(t)) return 'washer';
  if (/(\boven\b|\brange\b|stove|cooktop|\bbake\b|broil|burner)/.test(t)) return 'oven';
  if (/(microwave)/.test(t)) return 'microwave';
  return '';
}

// The knowledge base. pct = rough prior (share of this symptom that this component is);
// they're a starting rank, refined by history in diagnose(). confirm = the on-site test.
// part = the part CATEGORY to look up for the exact SKU. flags: gas / v240 / sealed.
const DX = {
  dryer: [
    { sym: /no heat|not heat|won'?t heat|not drying|won'?t dry|takes (a )?(long|forever)|clothes.*(wet|damp)|cold air|no dry/, note: 'ALWAYS check the vent first — a clogged/restricted vent overheats and is what blows fuses + kills elements; clearing it is often half the fix.', dx: [
      { component: 'heating element', confirm: 'ohm the element — open circuit or a visible break = bad', part: 'heating element', pct: 35 },
      { component: 'thermal fuse', confirm: 'ohm the thermal fuse — open = blown (find the vent restriction that blew it)', part: 'thermal fuse', pct: 25 },
      { component: 'cycling thermostat / hi-limit thermostat', confirm: 'ohm the cycling thermostat + hi-limit', part: 'thermostat kit', pct: 15 },
      { component: 'gas igniter / flame sensor', confirm: 'igniter glows then drops out without lighting = weak igniter; check flame sensor continuity', part: 'igniter', pct: 25, gas: true },
    ] },
    { sym: /won'?t start|no start|\bdead\b|won'?t turn on|not turning on|won'?t come on|not coming on|not working|no power|nothing happens|start button|push.?to.?start|button (is )?(not working|frozen|froze|stuck)/, dx: [
      { component: 'start switch / push-to-start', confirm: 'test the start switch (a bad/frozen start button is common)', part: 'start switch', pct: 28 },
      { component: 'thermal fuse', confirm: 'ohm it — open = blown', part: 'thermal fuse', pct: 25 },
      { component: 'door switch', confirm: 'test switch continuity with door closed', part: 'door switch', pct: 22 },
      { component: 'control board / timer', confirm: 'power but no response = control board / timer', part: 'control board', pct: 15 },
      { component: 'broken drive belt (belt switch trips)', confirm: 'open top — belt off or broken?', part: 'drive belt', pct: 10 },
    ] },
    { sym: /nois|loud|squeal|grind|thump|rumble|rattle|screech/, dx: [
      { component: 'drum support rollers', confirm: 'spin the drum by hand — growl/roughness', part: 'drum roller kit', pct: 30 },
      { component: 'idler pulley', confirm: 'inspect pulley bearing for squeal/wear', part: 'idler pulley', pct: 25 },
      { component: 'rear drum bearing / glides', confirm: 'check rear bearing + felt glides', part: 'bearing / glide kit', pct: 25 },
      { component: 'drive belt', confirm: 'check belt for fray/cracks', part: 'drive belt', pct: 15 },
    ] },
    { sym: /won'?t tumble|drum (not|won'?t) (turn|spin)|motor hums|not turning/, dx: [
      { component: 'broken drive belt', confirm: 'open top, inspect the belt', part: 'drive belt', pct: 45 },
      { component: 'drive motor', confirm: 'motor hums but won\'t turn = seized motor / bad start winding', part: 'drive motor', pct: 25 },
      { component: 'seized idler pulley', confirm: 'does the pulley spin freely?', part: 'idler pulley', pct: 15 },
    ] },
  ],
  washer: [
    { sym: /won'?t drain|not drain|water (left|standing|in|bottom)|drain/, dx: [
      { component: 'drain pump', confirm: 'check the pump for a sock/coin jam; test the pump motor', part: 'drain pump', pct: 45 },
      { component: 'clogged pump filter / drain hose', confirm: 'clean the pump filter + hose', part: 'clean (no part)', pct: 20 },
      { component: 'lid switch / door lock (spin won\'t engage)', confirm: 'top-load: test lid switch; front-load: test door lock', part: 'lid switch / door lock', pct: 15 },
    ] },
    { sym: /won'?t spin|not spin|no spin|clothes (soaked|sopping|wet)/, dx: [
      { component: 'lid switch (top-load) / door lock (front-load)', confirm: 'test the switch/lock continuity', part: 'lid switch / door lock', pct: 30 },
      { component: 'motor coupling (direct-drive) or drive belt', confirm: 'coupler cracked? belt worn?', part: 'motor coupling / belt', pct: 25 },
      { component: 'drain pump (won\'t spin until drained)', confirm: 'is it draining fully first?', part: 'drain pump', pct: 20 },
      { component: 'shift actuator / clutch', confirm: 'VMW models: test the shift actuator', part: 'shift actuator', pct: 15 },
    ] },
    { sym: /won'?t fill|no water|slow fill|not filling|little water/, dx: [
      { component: 'water inlet valve', confirm: 'check inlet screens + test the valve solenoids', part: 'inlet valve', pct: 40 },
      { component: 'water-level / pressure switch', confirm: 'test pressure switch + check its hose for a clog', part: 'pressure switch', pct: 20 },
      { component: 'door lock (won\'t fill until locked)', confirm: 'front-load: is the lock engaging?', part: 'door lock', pct: 15 },
    ] },
    { sym: /leak|leaking/, dx: [
      { component: 'door boot / bellow (front-load)', confirm: 'inspect the boot for tears at the bottom', part: 'door boot', pct: 30 },
      { component: 'drain pump / hose clamps', confirm: 'check the pump housing + hose clamps', part: 'pump / hoses', pct: 25 },
      { component: 'tub seal', confirm: 'leak from the center-bottom during spin', part: 'tub seal', pct: 20 },
    ] },
    { sym: /won'?t agitate|no agitat|doesn'?t agitate|agitator (is )?loose|agitator (not|won'?t)|screw (fell|loose|came)/, dx: [
      { component: 'gearcase / transmission', confirm: 'agitator loose or drives one way, or a growl on agitate = worn gearcase', part: 'gearcase / transmission', pct: 30 },
      { component: 'motor coupling / drive block', confirm: 'coupler cracked?', part: 'motor coupling', pct: 25 },
      { component: 'agitator dogs / cam kit', confirm: 'agitator drives one way only?', part: 'agitator repair kit', pct: 25 },
      { component: 'shift actuator', confirm: 'test the actuator', part: 'shift actuator', pct: 12 },
    ] },
    { sym: /nois|loud|grind|bang|rumble|clunk|shriek|whistl/, dx: [
      { component: 'tub bearing', confirm: 'spin the basket — growl/roughness on spin', part: 'tub bearing kit', pct: 26 },
      { component: 'gearcase / transmission (center bolt)', confirm: 'clunk on agitate, loose agitator, or oil leak under = gearcase', part: 'gearcase / transmission', pct: 22 },
      { component: 'shock absorbers / suspension', confirm: 'basket bangs on spin', part: 'shock / suspension kit', pct: 22 },
      { component: 'motor coupling', confirm: 'inspect the coupler', part: 'motor coupling', pct: 15 },
    ] },
    { sym: /won'?t start|no start|\bdead\b|no power|not working|not coming on|won'?t come on|not turning on|won'?t turn on|won'?t power|no lights|powers on.*(won'?t|then)|won'?t run/, dx: [
      { component: 'lid switch (top-load) / door lock (front-load)', confirm: 'won\'t start until it locks — test the lid switch / door lock', part: 'lid switch / door lock', pct: 30 },
      { component: 'main control board (CCU)', confirm: 'power but no function = CCU', part: 'main control board', pct: 25 },
      { component: 'user interface / control panel', confirm: 'buttons dead = interface board', part: 'interface board', pct: 22 },
      { component: 'line filter / thermal fuse (no power)', confirm: 'no power at all — check the line filter / thermal fuse', part: 'line filter / thermal fuse', pct: 13 },
    ] },
    { sym: /smell|odor|mildew|stink|musty/, dx: [
      { component: 'door boot / gasket biofilm (front-load)', confirm: 'clean the boot, run a tub-clean cycle, leave the door ajar between washes', part: 'clean (or door boot if torn)', pct: 60 },
    ] },
  ],
  refrigerator: [
    { sym: /(ice).*(won'?t|not|doesn'?t).*(dump|eject|drop|harvest|release)|makes ice.*(won'?t|not).*(dump|drop|release)|not dumping|won'?t harvest/, note: 'Force a test/harvest cycle first: if it EJECTS on test, the mechanism + motor are fine and it\'s the auto-trigger (bin-full sensor or temp). If it WON\'T eject on test, it\'s mechanical.', dx: [
      { component: 'ice-level / bin-full sensor (IR emitter+receiver, or feeler arm)', confirm: 'forced test ejects but auto won\'t = control reads the bin FULL; clean/verify the IR pair, or free a stuck feeler arm', part: 'ice-level sensor / control board', pct: 45 },
      { component: 'ice compartment too warm (harvest thermostat never trips)', confirm: 'if the ice is soft/slow: check the ice-room fan + damper, and that the freezer holds ~0°F', part: 'ice-room fan / damper', pct: 25 },
      { component: 'ice maker harvest motor/gear', confirm: 'only if a forced test ALSO fails to eject', part: 'ice maker assembly', pct: 20 },
    ] },
    { sym: /ice ?maker|no ice|not making ice|won'?t make ice|low ice/, dx: [
      { component: 'water inlet valve', confirm: 'no fill at all = inlet valve (or a frozen fill line)', part: 'water inlet valve', pct: 30 },
      { component: 'ice maker module / assembly', confirm: 'fills but won\'t cycle = module/assembly', part: 'ice maker assembly', pct: 30 },
      { component: 'frozen fill tube / water line', confirm: 'ice bridged at the fill tube', part: 'thaw (or line)', pct: 20 },
      { component: 'restricted water filter', confirm: 'old filter choking flow', part: 'water filter', pct: 10 },
    ] },
    { sym: /not cool|won'?t cool|warm|not cold|too warm|not getting cold|not freezing|not working|not coming on|won'?t come on|not turning on|\bdead\b|no power|not running/, dx: [
      { component: 'evaporator fan motor', confirm: 'freezer cold but fridge warm + no fan noise = evap fan', part: 'evaporator fan motor', pct: 22 },
      { component: 'defrost system (heater / thermostat / bi-metal / board)', confirm: 'frost caked on the evap coils = defrost failure', part: 'defrost heater / thermostat / board', pct: 25 },
      { component: 'compressor start relay / inverter', confirm: 'compressor not running or clicking = start relay (or inverter on linear comps)', part: 'start relay / inverter', pct: 20 },
      { component: 'condenser fan motor / dirty coils', confirm: 'both sides warm + compressor hot = condenser fan or clogged coils', part: 'condenser fan motor', pct: 15 },
      { component: 'sealed system (leak / restriction)', confirm: 'compressor runs, no cold, NO frost on evap = sealed system', part: 'sealed system repair', pct: 15, sealed: true },
    ] },
    { sym: /leak|water on (the )?floor|leaking water|water under/, dx: [
      { component: 'clogged / frozen defrost drain', confirm: 'water under the crispers or on the freezer floor = clogged defrost drain', part: 'clear drain (or drain heater)', pct: 40 },
      { component: 'water inlet valve / lines', confirm: 'check the valve + line fittings', part: 'inlet valve / line', pct: 25 },
      { component: 'water filter housing', confirm: 'leak at the filter head', part: 'filter housing', pct: 15 },
    ] },
    { sym: /water dispenser|dispenser (not|won'?t)|no water (from|at) (the )?door/, dx: [
      { component: 'frozen water line in the door', confirm: 'line frozen (door/freezer running too cold)', part: 'thaw (or door tube)', pct: 30 },
      { component: 'dispenser / water valve', confirm: 'test the dispenser valve solenoid', part: 'dispenser valve', pct: 30 },
      { component: 'dispenser switch / actuator', confirm: 'test the micro switch', part: 'dispenser switch', pct: 20 },
    ] },
    { sym: /nois|loud|buzz|rattle|grind|hum/, dx: [
      { component: 'evaporator fan motor', confirm: 'noise from the freezer, stops with the door switch', part: 'evaporator fan motor', pct: 30 },
      { component: 'condenser fan motor', confirm: 'noise from the bottom-rear', part: 'condenser fan motor', pct: 25 },
      { component: 'compressor', confirm: 'noise/vibration from the compressor', part: 'compressor', pct: 15, sealed: true },
    ] },
  ],
  oven: [
    { sym: /(oven|bake).*(no heat|won'?t heat|not heat)|not baking|won'?t bake|oven cold|not heating|\bno heat\b/, dx: [
      { component: 'bake element (electric)', confirm: 'ohm the element / look for a break or blister', part: 'bake element', pct: 40, v240: true },
      { component: 'oven igniter (gas)', confirm: 'igniter glows but the gas valve won\'t open = weak igniter (drawing under ~3A)', part: 'oven igniter', pct: 35, gas: true },
      { component: 'control / relay board', confirm: 'element or igniter is good but getting no power = relay board', part: 'control board', pct: 15 },
    ] },
    { sym: /broil/, dx: [
      { component: 'broil element (electric)', confirm: 'ohm the broil element', part: 'broil element', pct: 45, v240: true },
      { component: 'broil igniter (gas)', confirm: 'check igniter draw', part: 'igniter', pct: 30, gas: true },
    ] },
    { sym: /burner|won'?t light|no spark|not lighting|clicking|keeps clicking/, dx: [
      { component: 'spark igniter / electrode', confirm: 'clean + dry the igniter; check for spark', part: 'spark igniter', pct: 30, gas: true },
      { component: 'spark module', confirm: 'ALL burners click = the module', part: 'spark module', pct: 25, gas: true },
      { component: 'igniter switch', confirm: 'test the switch', part: 'igniter switch', pct: 20, gas: true },
    ] },
    { sym: /temp.*(off|wrong|not accurate)|too hot|runs (hot|cold)|not accurate|uneven bak/, dx: [
      { component: 'oven temp sensor (RTD)', confirm: 'ohm the sensor — ~1080Ω at room temp', part: 'oven temp sensor', pct: 45 },
      { component: 'control board', confirm: 'sensor reads good but temp is off = board', part: 'control board', pct: 20 },
    ] },
    { sym: /won'?t turn on|not turning on|not working|not coming on|won'?t come on|\bdead\b|no power|display (dead|blank|out)/, dx: [
      { component: 'control board', confirm: 'check board power + relays', part: 'control board', pct: 40 },
      { component: 'thermal fuse (some models)', confirm: 'ohm the fuse', part: 'thermal fuse', pct: 20 },
    ] },
  ],
  dishwasher: [
    { sym: /won'?t drain|not drain|water (in|left|bottom|standing)|standing water/, dx: [
      { component: 'drain pump', confirm: 'test the drain pump; clear the sump + check valve of glass/debris', part: 'drain pump', pct: 40 },
      { component: 'clogged filter / sump / check valve', confirm: 'clean the sump + filter', part: 'clean (no part)', pct: 30 },
      { component: 'kinked drain hose / plugged air gap', confirm: 'clear the air gap + hose', part: 'clear (no part)', pct: 15 },
    ] },
    { sym: /not clean|dirty|not washing|food left|not cleaning|dishes (dirty|not clean)/, dx: [
      { component: 'wash pump / motor', confirm: 'weak or no spray pressure = wash motor', part: 'wash pump / motor', pct: 25 },
      { component: 'chopper/macerator + clogged spray arms', confirm: 'clear the spray-arm holes + chopper', part: 'chopper / spray arm', pct: 25 },
      { component: 'water inlet valve (low fill)', confirm: 'check the fill level', part: 'inlet valve', pct: 20 },
    ] },
    { sym: /won'?t fill|no water|not filling/, dx: [
      { component: 'water inlet valve', confirm: 'test the valve solenoid + screen', part: 'inlet valve', pct: 45 },
      { component: 'float switch stuck up', confirm: 'free the float', part: 'float switch', pct: 20 },
    ] },
    { sym: /leak|leaking/, dx: [
      { component: 'door gasket / tub seal', confirm: 'inspect the door + tub gasket', part: 'door gasket', pct: 30 },
      { component: 'pump / sump seal', confirm: 'leak at the pump housing', part: 'pump seal', pct: 25 },
      { component: 'inlet valve / hose', confirm: 'check the fittings', part: 'valve / hose', pct: 20 },
    ] },
    { sym: /won'?t start|\bdead\b|no power|won'?t turn on|not turning on|not working|not coming on|won'?t come on|no lights/, dx: [
      { component: 'door latch / latch switch', confirm: 'test the latch switch continuity', part: 'door latch', pct: 35 },
      { component: 'control board', confirm: 'check board power', part: 'control board', pct: 25 },
      { component: 'thermal fuse (on the control)', confirm: 'ohm the fuse', part: 'thermal fuse', pct: 15 },
    ] },
  ],
};

function normComp(c) { return String(c || '').toLowerCase(); }

// The engine. Input: { appliance, brand, model, symptom, history? }
//   history = optional array of the shop's failed_component strings for this model/brand.
// Returns ranked component diagnoses (knowledge-base priors, BOOSTED by history), each
// with the confirm test + the part category to look up, plus safety flags + guidance.
function diagnose(input) {
  const symptom = String((input && input.symptom) || '');
  const appliance = canonAppliance((input && input.appliance) || '') || canonAppliance(symptom);
  const out = { appliance: appliance || null, matched: false, note: '', diagnoses: [], safety: [], grounded_by_history: 0 };
  if (!appliance || !DX[appliance]) { out.note = 'Need the appliance + a symptom to diagnose.'; return out; }

  // Normalize before matching: strip a leading "Other"/category placeholder + any
  // appended call/note noise, then convert smart/curly apostrophes (’ ‘ ´ ` ʼ) to a
  // straight ' so "won’t"/"won`t" from iOS autocorrect + phone transcription match.
  const t = String(symptom)
    .split(/\s*\|\|\s*/)[0]
    .replace(/\[(phone call|call|note|voicemail|vm|sms|text|system)\][\s\S]*$/i, '')
    .replace(/^\s*(other|general|misc(ellaneous)?)\b[:\-\s]*/i, '')
    .toLowerCase().replace(/[‘’ʼ´`]/g, "'").trim();
  const block = DX[appliance].find((b) => b.sym.test(t));
  if (!block) {
    out.note = 'No symptom pattern matched yet — describe what it\'s doing (won\'t drain / no heat / not cooling / makes noise…).';
    return out;
  }
  out.matched = true;
  if (block.note) out.note = block.note;

  // Fuel awareness: a GAS oven/dryer that won't heat is the igniter, not the element —
  // and vice versa. Detect the fuel from the text and boost/demote accordingly so the
  // right cause leads. Unknown fuel leaves the KB priors alone.
  const fuel = /\bgas\b|propane|\blp\b/.test(t) ? 'gas' : (/\belectric\b|\b240v?\b|coil element/.test(t) ? 'electric' : '');

  // History boost: any shop failure whose component text overlaps a KB component bumps it.
  const hist = Array.isArray(input && input.history) ? input.history.map(normComp) : [];
  const ranked = block.dx.map((d) => {
    let score = d.pct || 0;
    if (fuel === 'gas') { if (d.gas) score += 30; if (d.v240) score = Math.round(score * 0.25); }
    else if (fuel === 'electric') { if (d.gas) score = Math.round(score * 0.2); }
    let seen = 0;
    if (hist.length) {
      const key = normComp(d.component).split(/[\/(]/)[0].trim();
      const words = key.split(/\s+/).filter((w) => w.length >= 4);
      seen = hist.filter((h) => words.some((w) => h.includes(w))).length;
      if (seen) { score += Math.min(40, seen * 12); out.grounded_by_history += seen; }
    }
    return {
      component: d.component,
      confirm: d.confirm,
      part_category: d.part,
      likelihood: score,
      seen_in_history: seen,
      flags: [d.gas ? 'gas' : null, d.v240 ? '240V' : null, d.sealed ? 'sealed-system' : null].filter(Boolean),
    };
  }).sort((a, b) => b.likelihood - a.likelihood);

  // Renormalize likelihood to % of the total so it reads as a confidence split.
  const tot = ranked.reduce((s, x) => s + x.likelihood, 0) || 1;
  ranked.forEach((x) => { x.likelihood = Math.round((x.likelihood / tot) * 100); });
  out.diagnoses = ranked;

  // Safety routing.
  const flagset = new Set(ranked.flatMap((x) => x.flags));
  if (flagset.has('sealed-system')) out.safety.push('Sealed-system work (recover/evac/charge) — EPA cert + the right tools; route to a sealed-system pro if not equipped.');
  if (flagset.has('gas')) out.safety.push('Gas appliance — confirm no gas leak; only qualified gas work.');
  if (flagset.has('240V')) out.safety.push('240V element — pull the breaker before ohming/replacing.');
  return out;
}

module.exports = { diagnose, canonAppliance, DX };
