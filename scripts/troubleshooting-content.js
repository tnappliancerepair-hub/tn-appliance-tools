// troubleshooting-content.js — the curated, expert-authored source data for the
// authority content library. Each entry becomes a deep, honest symptom page under
// /fix/ with FAQ + HowTo + Breadcrumb schema, built to be the answer a voice
// assistant or AI quotes for "my <appliance> <symptom> — what do I do?".
//
// QUALITY RULE: real, accurate repair knowledge only. DIY steps stay SAFE (unplug
// first, visual/simple checks); the actual repair routes to us (local) or the
// nationwide video diagnostic. Gas/sealed-system work is always "call a pro".
// Add an entry + re-run scripts/build-troubleshooting-pages.js to grow the library.
'use strict';

module.exports = [
  {
    slug: 'washer-wont-drain',
    appliance: 'Washer',
    question: 'My washer won\'t drain — what do I do?',
    metaTitle: 'Washer Won\'t Drain? Causes & Fixes From a Real Technician',
    metaDesc: 'A washer that won\'t drain is usually a clogged pump filter, a kinked drain hose, or a failed drain pump. Here\'s how to tell — and get it fixed.',
    intro: 'A washer that fills and washes but leaves standing water almost always comes down to one thing: something between the tub and your drain is blocked or the pump has quit. The good news is that this is one of the most common — and most affordable — repairs we do. Here are the real causes, in the order we check them, plus the safe things you can look at yourself before you call anyone.',
    safety: 'Always unplug the washer before touching the pump or hoses, and have towels ready — there will be trapped water.',
    causes: [
      { name: 'Clogged pump filter / coin trap', why: 'Front-load washers (and many high-efficiency top-loaders) have a small filter that catches coins, hair pins, and lint. When it clogs, water can\'t leave the tub. This is the single most common cause and often a 10-minute fix.', diy: 'Unplug the washer, find the small access panel at the bottom front, put down towels, and slowly open the filter to drain and clear it.', difficulty: 'Easy' },
      { name: 'Kinked or clogged drain hose', why: 'The hose running to your standpipe or disposal can kink behind the machine or clog with lint and gunk, especially where it connects.', diy: 'Pull the washer out, check the hose for kinks or crush points, and make sure it isn\'t pushed too far down the drain (which causes siphoning).', difficulty: 'Easy' },
      { name: 'Failed drain pump', why: 'The drain pump is a small motor that pushes water out. When the bearings wear or the motor burns out, you\'ll often hear a humming or grinding with no water movement. This is a common, affordable part.', diy: 'Listen during the drain cycle — a hum with no draining, or silence, points at the pump. Replacement is a real repair, not a DIY check.', difficulty: 'Pro' },
      { name: 'Object stuck in the pump impeller', why: 'A sock, underwire, or coin can jam the pump impeller so it can\'t spin.', diy: 'With the machine unplugged and the filter open, you can sometimes feel for and remove a foreign object at the impeller.', difficulty: 'Moderate' },
      { name: 'Lid switch or door lock', why: 'Most washers won\'t advance to drain and spin if the machine doesn\'t think the lid or door is securely closed.', diy: 'Confirm the door latches firmly. A failed lid switch or door lock is a technician repair.', difficulty: 'Pro' },
    ],
    repairReplace: 'A drain pump, filter clog, or hose issue is an inexpensive fix and is almost always worth repairing — on any washer, at any age. The only time replacement enters the conversation is when a drain problem is paired with other major failures (bad bearings plus a dead control board, for example).',
    faqs: [
      { q: 'Why is there standing water in my washer?', a: 'Standing water means the drain step failed. The usual causes are a clogged pump filter, a kinked or clogged drain hose, or a worn-out drain pump. Start by unplugging the machine and checking the filter at the bottom front.' },
      { q: 'Can I fix a washer that won\'t drain myself?', a: 'You can safely check and clear the pump filter, inspect the drain hose for kinks, and look for a stuck object at the impeller — all with the machine unplugged. If the pump itself has failed or the lid switch is bad, that\'s a technician repair.' },
      { q: 'Is a washer that won\'t drain worth fixing?', a: 'Almost always yes. The most common causes — a clogged filter, a hose, or a drain pump — are inexpensive repairs on any age of washer.' },
    ],
  },
  {
    slug: 'dryer-not-heating',
    appliance: 'Dryer',
    question: 'My dryer runs but won\'t heat — what do I do?',
    metaTitle: 'Dryer Not Heating? The Real Causes & How to Fix It',
    metaDesc: 'A dryer that runs but won\'t heat is usually a heating element, a blown thermal fuse from a clogged vent, or a lost 240V leg. Here\'s how to diagnose it.',
    intro: 'When a dryer tumbles fine but everything comes out cold and damp, the problem is in the heat circuit — not the motor. Nine times out of ten it traces back to one of a few affordable parts, and very often the root cause is a clogged vent that overheated and tripped a safety device. Here is exactly what we check, and the safe things you can look at first.',
    safety: 'Unplug an electric dryer before checking anything internal. For GAS dryers, do not attempt igniter or gas-valve work yourself — that is a call-a-pro repair.',
    causes: [
      { name: 'Clogged vent (the hidden root cause)', why: 'A restricted vent traps heat inside the dryer and trips the thermal fuse or high-limit thermostat as a safety measure. Fix the part without clearing the vent and it just fails again. It\'s also the #1 dryer fire risk.', diy: 'Disconnect and clear the vent hose and exhaust duct. If drying has been slow for weeks, this is very likely part of your problem.', difficulty: 'Easy' },
      { name: 'Heating element', why: 'The element produces the heat. On electric dryers it burns out over time and the dryer runs cold. This is a common, affordable part.', diy: 'No safe DIY test without a meter and disassembly — but a dryer that tumbles normally with zero heat often points here.', difficulty: 'Pro' },
      { name: 'Blown thermal fuse', why: 'A one-time safety fuse that cuts heat (or all power, depending on model) when the dryer overheats — usually because of that clogged vent.', diy: 'Clear the vent first. The fuse itself is a technician replacement, and it must be paired with fixing the airflow that blew it.', difficulty: 'Pro' },
      { name: 'Thermal cutoff / high-limit thermostat', why: 'These regulate and cap the temperature. When they fail, heat can drop out.', diy: 'Not a DIY check. Diagnosed and replaced by a technician.', difficulty: 'Pro' },
      { name: 'Lost 240V leg (electric dryers)', why: 'Electric dryers use two 120V legs. If one breaker leg trips or fails, the motor still runs on one leg but the element gets no power — so it tumbles but won\'t heat.', diy: 'Check your breaker: fully switch the dryer\'s double breaker off and back on. If a leg is lost at the panel, that\'s an electrical issue.', difficulty: 'Easy' },
      { name: 'Gas igniter or flame sensor (gas dryers)', why: 'On gas models a weak igniter or bad flame sensor stops the burner from lighting, so no heat.', diy: 'Do not DIY gas components. This is a technician repair for safety.', difficulty: 'Pro' },
    ],
    repairReplace: 'Heating elements, fuses, thermostats, and igniters are all affordable parts, and the labor is straightforward — a no-heat dryer is well worth repairing in almost every case. Clearing the vent at the same time is what keeps the fix from failing again.',
    faqs: [
      { q: 'Why does my dryer run but not get hot?', a: 'The motor and the heat circuit are separate. If it tumbles but stays cold, the issue is in the heat side — most often a heating element, a thermal fuse blown by a clogged vent, or (on electric dryers) a lost 240V breaker leg.' },
      { q: 'Can a clogged vent stop a dryer from heating?', a: 'Yes. A restricted vent traps heat and trips the thermal fuse or high-limit thermostat as a safety response, cutting the heat. Clearing the vent is the first thing to do — and it prevents a fire hazard.' },
      { q: 'Is it worth fixing a dryer that won\'t heat?', a: 'Usually yes. The common causes are inexpensive parts and a quick repair. Replacement only makes sense if the dryer has other major problems on top of the no-heat issue.' },
    ],
  },
  {
    slug: 'refrigerator-not-cooling',
    appliance: 'Refrigerator',
    question: 'My refrigerator stopped cooling — what do I do?',
    metaTitle: 'Refrigerator Not Cooling? Causes, Checks & When to Call',
    metaDesc: 'A fridge that runs but won\'t cool is often dirty condenser coils, a failed evaporator fan, or a defrost problem. Here\'s how to tell what\'s wrong.',
    intro: 'A refrigerator that\'s running but not getting cold is stressful — you\'re watching food go warm. Before you assume the worst (an expensive compressor), know that most "not cooling" calls we get turn out to be an affordable fix: airflow, a fan, or the defrost system. Here\'s how we work through it, and what you can safely check right now.',
    safety: 'Unplug the refrigerator before cleaning coils or checking fans. Sealed-system and compressor work requires a licensed technician — never attempt it yourself.',
    causes: [
      { name: 'Dirty condenser coils', why: 'Coils caked in dust and pet hair can\'t release heat, so the fridge runs constantly and still won\'t cool. This is the most common and most preventable cause.', diy: 'Unplug the fridge, find the coils (behind the kick plate or on the back), and vacuum them clean.', difficulty: 'Easy' },
      { name: 'Evaporator fan motor', why: 'This fan moves cold air from the freezer coils into the fridge compartment. If it fails, the freezer may stay cold-ish while the fridge section warms up.', diy: 'Listen: open the freezer and press the door switch — you should hear the fan. Silence points here. Replacement is a technician repair.', difficulty: 'Pro' },
      { name: 'Defrost system failure', why: 'Frost builds on the evaporator coils and blocks airflow when the defrost heater, thermostat, or timer/board fails. Classic sign: freezer works, fridge doesn\'t, and you see frost buildup.', diy: 'If you see heavy frost on the back freezer wall, that\'s the clue. The repair is a technician job.', difficulty: 'Pro' },
      { name: 'Condenser fan motor', why: 'On coil-in-back-cabinet models, this fan cools the compressor and coils. If it stops, the system overheats and cooling drops.', diy: 'Not a safe DIY check. Diagnosed by a technician.', difficulty: 'Pro' },
      { name: 'Start relay / compressor', why: 'The compressor is the heart of the system. A failed start relay (cheap) can stop it from running; a failed compressor (expensive) is the rare worst case.', diy: 'Not DIY. A technician confirms whether it\'s the affordable relay or the compressor itself.', difficulty: 'Pro' },
      { name: 'Overpacked or blocked vents', why: 'Blocking the interior air vents with food stops cold air from circulating.', diy: 'Make sure nothing is jammed against the vents inside the fridge and freezer.', difficulty: 'Easy' },
    ],
    repairReplace: 'Coils, fans, start relays, and defrost parts are all affordable and worth fixing. The one expensive scenario is a failed compressor or a sealed-system leak — and that\'s exactly the situation where our honest repair-vs-replace math matters most, so you don\'t sink money into a fridge that isn\'t worth it. We tell you straight.',
    faqs: [
      { q: 'Why is my fridge running but not cold?', a: 'Running-but-warm usually means airflow or a fan, not the compressor. The most common causes are dirty condenser coils, a failed evaporator fan, or a defrost-system problem building frost on the coils. Start by vacuuming the coils.' },
      { q: 'What can I check before calling a refrigerator repair tech?', a: 'Safely: vacuum the condenser coils, make sure the interior vents aren\'t blocked by food, listen for the evaporator fan when you press the freezer door switch, and look for heavy frost on the back freezer wall.' },
      { q: 'Is it worth repairing a refrigerator that won\'t cool?', a: 'Most causes — coils, fans, relays, defrost parts — are affordable and worth fixing. The exception is a failed compressor or sealed-system leak; for those we give you honest repair-vs-replace numbers before you spend a dime.' },
    ],
  },
  {
    slug: 'dishwasher-wont-drain',
    appliance: 'Dishwasher',
    question: 'My dishwasher won\'t drain — what do I do?',
    metaTitle: 'Dishwasher Won\'t Drain? Simple Causes & Fixes',
    metaDesc: 'Standing water in your dishwasher is usually a clogged filter, a garbage-disposal knockout plug, or the drain pump. Here\'s how to clear it.',
    intro: 'Water in the bottom of the dishwasher after a cycle is a classic — and usually simple — problem. A lot of the time it\'s something you can clear in a few minutes, especially if a new garbage disposal was just installed. Here are the causes in the order we check them.',
    safety: 'Turn the dishwasher off at the breaker before reaching near the drain pump. Scoop out standing water with a cup and towel first.',
    causes: [
      { name: 'Clogged filter or sump', why: 'Food, grease, and debris build up in the filter at the bottom of the tub and block drainage. This is the most common cause and an easy clean.', diy: 'Remove the bottom rack, twist out the filter, and rinse it under hot water. Clear any debris in the sump.', difficulty: 'Easy' },
      { name: 'Garbage disposal knockout plug', why: 'If a new garbage disposal was recently installed and the dishwasher won\'t drain, the installer likely forgot to knock out the drain plug inside the disposal inlet. Extremely common.', diy: 'Check under the sink — if a new disposal went in recently, the knockout plug may need to be removed from the disposal\'s dishwasher inlet.', difficulty: 'Moderate' },
      { name: 'Clogged or kinked drain hose', why: 'The hose from the dishwasher to the disposal or standpipe can clog or kink.', diy: 'Check the hose under the sink for kinks. A deep clog is a technician clear-out.', difficulty: 'Moderate' },
      { name: 'Drain pump', why: 'The pump that pushes water out can fail or jam with glass or debris.', diy: 'A humming pump with no draining points here. Replacement is a technician repair.', difficulty: 'Pro' },
      { name: 'Check valve stuck', why: 'A one-way valve keeps drained water from flowing back; if it sticks, drainage suffers.', diy: 'Not a typical DIY check. Diagnosed by a technician.', difficulty: 'Pro' },
    ],
    repairReplace: 'The vast majority of dishwasher drain problems are cheap fixes — a filter clean, a knockout plug, or a hose. Even a drain pump is an affordable part. A dishwasher that won\'t drain is almost always worth repairing.',
    faqs: [
      { q: 'Why is there water at the bottom of my dishwasher?', a: 'A small amount is normal; a full pool after a cycle means it didn\'t drain. The usual causes are a clogged filter, a garbage-disposal knockout plug that was never removed, a kinked drain hose, or a failed drain pump.' },
      { q: 'I just got a new garbage disposal and my dishwasher won\'t drain — why?', a: 'This is very common. New disposals ship with a knockout plug in the dishwasher inlet that must be removed during installation. If it was missed, the dishwasher can\'t drain into the disposal. Removing the plug fixes it.' },
      { q: 'Can I fix a dishwasher that won\'t drain myself?', a: 'Often yes — cleaning the filter and checking the disposal knockout are safe, simple steps. If the drain pump has failed or there\'s a deep clog, that\'s a technician repair.' },
    ],
  },
  {
    slug: 'oven-not-heating',
    appliance: 'Oven',
    question: 'My oven won\'t heat — what do I do?',
    metaTitle: 'Oven Won\'t Heat? Electric & Gas Causes Explained',
    metaDesc: 'An oven that won\'t heat is usually a bake element (electric) or a weak igniter (gas). Here\'s how to tell which — and what\'s safe to check.',
    intro: 'An oven that won\'t come up to temperature splits cleanly by fuel type: on electric ovens it\'s almost always the bake element, and on gas ovens it\'s almost always the igniter. Both are common, affordable repairs. Here\'s how to tell what you\'re dealing with, and the safe checks first.',
    safety: 'For GAS ovens, do not attempt igniter or gas-valve work yourself — call a technician. For electric ovens, cut power at the breaker before inspecting anything.',
    causes: [
      { name: 'Bake element (electric ovens)', why: 'The bottom heating element is the most common electric-oven failure. A failed element often has a visible blister, break, or burn spot and won\'t glow.', diy: 'Look at the element with the oven cool: a visible break or burn mark is a strong sign. Replacement is a straightforward repair.', difficulty: 'Moderate' },
      { name: 'Oven igniter (gas ovens)', why: 'The igniter both lights the gas and tells the valve to open. As it weakens with age it glows but no longer gets hot enough to open the valve — so the oven doesn\'t heat. This is the #1 gas-oven failure.', diy: 'You may see the igniter glow but no flame. Do not DIY gas parts — this is a technician repair for safety.', difficulty: 'Pro' },
      { name: 'Temperature sensor', why: 'The oven\'s temperature sensor tells the control how hot it is. A failed sensor can cause no-heat or wildly wrong temperatures.', diy: 'Not a DIY check. Diagnosed by a technician.', difficulty: 'Pro' },
      { name: 'Control board or thermal fuse', why: 'A failed control board or a tripped thermal fuse can cut power to the heat circuit.', diy: 'Not DIY. A technician confirms and replaces.', difficulty: 'Pro' },
      { name: 'Wrong mode or lock', why: 'Delay-start, Sabbath mode, or a self-clean lock can make an oven seem dead.', diy: 'Confirm the oven isn\'t in a delay, lock, or self-clean cycle before assuming a failure.', difficulty: 'Easy' },
    ],
    repairReplace: 'A bake element or a gas igniter is an affordable part and a quick repair — an oven that won\'t heat is well worth fixing in nearly every case. Replacement only makes sense on a very old range with multiple failing systems.',
    faqs: [
      { q: 'Why won\'t my electric oven heat up?', a: 'On an electric oven the usual culprit is a failed bake element — often with a visible blister or break. A bad temperature sensor or control board is possible but less common. The bake element is an affordable, common repair.' },
      { q: 'My gas oven igniter glows but there\'s no flame — why?', a: 'That\'s the classic sign of a weak igniter. As it ages it still glows but can no longer get hot enough to open the gas valve, so the oven never heats. The igniter needs replacing — and because it\'s gas, it should be done by a technician.' },
      { q: 'Is an oven that won\'t heat worth repairing?', a: 'Usually yes. The two most common causes — an electric bake element or a gas igniter — are inexpensive parts with quick labor.' },
    ],
  },
  {
    slug: 'washer-not-spinning',
    appliance: 'Washer',
    question: 'My washer won\'t spin — what do I do?',
    metaTitle: 'Washer Won\'t Spin? Causes and What to Check First',
    metaDesc: 'A washer that won\'t spin is often a drain problem, an unbalanced load, a lid switch, or a worn belt or coupler. Here\'s how to narrow it down.',
    intro: 'A washer that won\'t spin leaves you with a soaking, heavy load. The first thing to know: a machine won\'t spin until it has fully drained — so a spin problem is very often really a drain problem. After that, it\'s usually a switch, a belt, or (on top-loaders) the coupler. Here\'s how we sort it out.',
    safety: 'Unplug the washer before checking the lid switch, belt, or coupler, and redistribute a wet load carefully — it\'s heavy.',
    causes: [
      { name: 'It hasn\'t fully drained', why: 'Most washers refuse to spin until the water is out. If there\'s standing water, fix the drain issue first — the spin will usually return with it.', diy: 'Check for standing water and clear the pump filter/drain hose (see our washer-won\'t-drain guide).', difficulty: 'Easy' },
      { name: 'Unbalanced load', why: 'A bulky or lopsided load (a comforter, towels bunched to one side) trips the balance sensor and cancels the spin to protect the machine.', diy: 'Open the lid, redistribute the load evenly, and restart the spin.', difficulty: 'Easy' },
      { name: 'Lid switch or door lock', why: 'The machine won\'t spin if it doesn\'t sense a securely closed lid or locked door. A failed switch is a common cause.', diy: 'Confirm the lid latches firmly and you hear/feel it engage. A failed switch is a technician repair.', difficulty: 'Pro' },
      { name: 'Motor coupler (top-loaders)', why: 'On many top-load washers a plastic coupler connects the motor to the transmission and wears out — the washer runs but won\'t agitate or spin.', diy: 'Not a DIY check, but a very common and affordable repair on top-loaders.', difficulty: 'Pro' },
      { name: 'Drive belt', why: 'A stretched, slipped, or broken belt stops the drum from spinning.', diy: 'Not a DIY check. A technician inspects and replaces the belt.', difficulty: 'Pro' },
    ],
    repairReplace: 'Lid switches, couplers, and belts are all inexpensive parts with reasonable labor — a no-spin washer is almost always worth repairing. The only time to reconsider is when the no-spin is paired with bad main bearings (a loud, expensive repair) on an older machine.',
    faqs: [
      { q: 'Why won\'t my washer spin the water out?', a: 'Most washers won\'t spin until they\'ve fully drained, so a no-spin problem is often really a drain problem. Beyond that, the common causes are an unbalanced load, a failed lid switch or door lock, or a worn belt or motor coupler.' },
      { q: 'My washer fills and washes but won\'t spin — what\'s wrong?', a: 'If it agitates but won\'t spin, look at the drain first (it must be empty to spin), then the lid switch, and on top-loaders the motor coupler. On front-loaders, the door lock and belt are common causes.' },
      { q: 'Is a washer that won\'t spin worth fixing?', a: 'Usually yes — lid switches, couplers, and belts are affordable. Reconsider only if it\'s paired with worn bearings on an older machine, and we\'ll give you the honest numbers.' },
    ],
  },
];
