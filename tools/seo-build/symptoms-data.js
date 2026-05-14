// Symptom-page content. One object per URL slug.
// Tone: savvy professional. Honest, not salesy. Liability-safe — no repair instructions.
// Every field surfaces on the page; "quickAnswer" is the AI-Overview hook.

module.exports = [
  // ===== DRYER =====
  {
    slug: "dryer-not-heating",
    appliance: "dryer",
    title: "Dryer Not Heating",
    h1: "Dryer Not Heating",
    metaTitle: "Dryer Not Heating? Here's What's Actually Wrong | TN Appliance Exchange",
    metaDesc: "Dryer not heating but tumbles fine? It's almost always one of three parts — and a real technician can tell you which. Honest pricing. Quick Check $50 credited to repair.",
    keywords: "dryer not heating, dryer won't heat, dryer no heat, dryer heating element, dryer thermal fuse, dryer not getting hot",
    icon: "🌀",
    quickAnswer: "A dryer that tumbles but won't heat is almost always a blown thermal fuse, a failed heating element, or a bad thermostat. The vent is the silent culprit — restricted airflow trips fuses again and again until it's cleared. A real technician can pinpoint which part by reviewing your model and symptoms.",
    causes: [
      { title: "Restricted vent or lint blockage", body: "Heat needs somewhere to go. When the vent line is packed with lint or kinked behind the unit, temperature rises until a safety fuse pops. Most repeat 'no heat' calls trace back here." },
      { title: "Blown thermal fuse", body: "A one-shot safety device. Once it blows, no power reaches the heating circuit. Easy to replace — but if you don't fix the airflow problem that blew it, it'll blow again." },
      { title: "Failed heating element (electric) or igniter (gas)", body: "On electric dryers the element burns through. On gas dryers the igniter glows weak or won't light. Different parts entirely — the model number tells us which path we're on." },
      { title: "High-limit thermostat or cycling thermostat", body: "These regulate temperature. When they fail open, the heating circuit stays off. They often fail alongside a thermal fuse from the same airflow root cause." },
      { title: "Bad timer or control board", body: "Less common but real. If voltage isn't reaching the element on a working cycle, the brains are the next place to look." }
    ],
    isItWorthFixing: "Almost always yes. The most common no-heat repairs (thermal fuse, element, thermostat) run $150–$300 with parts and labor — a fraction of a new dryer. Age matters less than parts availability: a well-built 12-year-old Maytag is often worth fixing twice. A four-year-old machine with a discontinued board is the one to think hard about. The TDR gives you both options side-by-side so the choice is yours, not ours.",
    relatedSymptoms: ["dryer-takes-too-long", "dryer-smells-like-burning", "dryer-wont-start", "dryer-error-codes"],
    faqs: [
      { q: "Why is my dryer not heating but still running?", a: "When a dryer tumbles but doesn't heat, the motor circuit is fine but the heating circuit isn't getting power or has a broken part. The usual suspects: thermal fuse, heating element, thermostat. A blocked vent often causes the fuse to blow in the first place." },
      { q: "Can I run my dryer with no heat?", a: "You can — it'll just take forever and never fully dry. We don't recommend it. Wet clothes sitting in a barely-warm drum encourage mildew, and the underlying problem usually gets worse." },
      { q: "How much does it cost to fix a dryer that won't heat?", a: "Most no-heat dryer repairs land between $150 and $300 with parts and labor. Thermal fuses are the cheap end; heating elements and thermostats are the middle; control board failures are rarer and pricier." },
      { q: "Is it worth fixing a dryer that's 10 years old?", a: "Often yes. Older dryers were built with serviceable parts and metal drums. If the part is available and the labor is straightforward, repair almost always beats replacement at this age. Our techs give you the real number on your specific machine." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 Quick Check or $100 in-home diagnostic fee applies directly to the labor cost of the repair if you proceed. You never double pay." }
    ]
  },
  {
    slug: "dryer-not-spinning",
    appliance: "dryer",
    title: "Dryer Not Spinning",
    h1: "Dryer Not Spinning",
    metaTitle: "Dryer Won't Spin or Tumble? Here's What's Actually Wrong | TN Appliance Exchange",
    metaDesc: "Dryer hums but the drum won't turn? It's usually a belt, idler pulley, or motor. Honest 4-option Technician Decision Report. $50 Quick Check credited to your repair.",
    keywords: "dryer not spinning, dryer won't tumble, dryer drum not turning, dryer belt broken, dryer motor",
    icon: "🌀",
    quickAnswer: "A dryer that hums but doesn't spin almost always has a snapped drive belt, a seized idler pulley, or worn drum rollers. Sometimes the motor itself is gone. A real technician can tell which it is by sound, model number, and a quick video — and give you the exact repair cost before anyone touches it.",
    causes: [
      { title: "Snapped drive belt", body: "The thin rubber belt that wraps the drum eventually frays and breaks. The motor runs but nothing turns. It's the most common cause, and parts are widely available on almost every model." },
      { title: "Worn drum rollers or glides", body: "The drum rides on small wheels (or plastic slides). When they wear out, the drum binds, the belt slips, or the dryer makes a thumping sound right before quitting." },
      { title: "Seized idler pulley", body: "Tensions the belt against the motor. When the bearing fails it locks up and either snaps the belt or stops the drum cold." },
      { title: "Motor failure", body: "Less common but possible. If you hear a buzz with no spin and the belt is intact, the motor windings or start capacitor may be done." },
      { title: "Broken door switch", body: "If the switch doesn't tell the control board the door is closed, the dryer won't engage the motor at all. Cheap part — but you have to know it's the right one." }
    ],
    isItWorthFixing: "Yes, in almost every case. Belt + idler + rollers as a complete refresh runs $200–$300 and gives you another decade of reliable service on a well-built machine. Motor replacement is the gray-area call: on a 15-year-old budget unit, replacement may make more sense; on a heavy-duty commercial-style unit, the motor swap is worth it. The TDR shows the math both ways.",
    relatedSymptoms: ["dryer-making-noise", "dryer-wont-start", "dryer-door-wont-close", "dryer-not-heating"],
    faqs: [
      { q: "Why does my dryer hum but not spin?", a: "The motor is getting power but the drum isn't engaging. Nine times out of ten it's a broken belt, a seized idler pulley, or worn rollers binding the drum. The diagnostic separates the three quickly." },
      { q: "How much does a dryer belt replacement cost?", a: "Most belt replacements run $150–$250 with parts and labor. We usually replace the idler pulley and rollers at the same time if they show wear — once the dryer is apart, the additional labor is minimal and prevents a repeat visit." },
      { q: "Can I keep using my dryer if it won't spin?", a: "No. If the motor is running with a stalled drum or stuck belt, you risk overheating the motor windings and turning a cheap repair into an expensive one. Unplug it and start a Quick Check." },
      { q: "Is a dryer worth fixing if the motor is gone?", a: "Depends on the machine. On a high-end stacked unit or commercial dryer, motor replacement is absolutely worth it. On a 12-year-old budget dryer where parts are scarce, replacement may win. We give you both numbers." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 Quick Check or $100 in-home diagnostic fee applies directly to the labor cost of the repair if you move forward. You only pay once." }
    ]
  },
  {
    slug: "dryer-making-noise",
    appliance: "dryer",
    title: "Dryer Making Noise",
    h1: "Dryer Making Noise",
    metaTitle: "Dryer Making Loud Noise? Squeaking, Thumping, Grinding | TN Appliance Exchange",
    metaDesc: "Dryer squeaking, thumping, or grinding? Each sound points to a specific part. A real technician can tell which by the sound. $50 Quick Check, credited to repair.",
    keywords: "dryer making noise, dryer loud, dryer squeaking, dryer thumping, dryer grinding, noisy dryer",
    icon: "🌀",
    quickAnswer: "Squeaking usually means worn drum rollers or a tired idler pulley. Thumping points to drum bearings or a loose drum seal. Grinding is almost always blower wheel debris or a failing motor bearing. Each sound points to a different part — and the fix is usually under $300.",
    causes: [
      { title: "Worn drum support rollers", body: "Small wheels under the drum that flatten over time. The classic 'squeak that gets louder as it heats up' sound. Cheap parts, real labor to access." },
      { title: "Failing idler pulley", body: "Squeals or chirps as the belt rides over a dry bearing. Replace the belt at the same time — the labor is identical." },
      { title: "Loose or worn drum seal", body: "Felt seals between the drum and bulkhead wear thin. You'll hear a low whoosh or thump as fabric catches the gap." },
      { title: "Coins, lighters, or loose hardware in the blower", body: "Stuff falls through pockets and lodges in the blower wheel. Grinding or rattling that changes pitch as the drum turns." },
      { title: "Motor bearing failure", body: "Less common. A deep, constant grinding tied to motor speed — usually paired with reduced spin power." }
    ],
    isItWorthFixing: "Yes for rollers, idler, belt, and seals — all standard $150–$300 repairs that give you years of quiet service. Motor bearing replacement is the borderline call and depends on the machine. The honest test: if the noise just started, fix it now before it cascades into the belt or motor.",
    relatedSymptoms: ["dryer-not-spinning", "dryer-takes-too-long", "dryer-not-heating", "dryer-wont-start"],
    faqs: [
      { q: "Why is my dryer making a loud thumping noise?", a: "Thumping usually means a worn drum seal, a flat-spotted roller, or something loose inside the drum hitting the bulkhead. The pattern of the thump — once per revolution vs. random — narrows it down fast." },
      { q: "Is it safe to use a dryer that's making noise?", a: "Short term yes, but you're racing the clock. A squeaking roller can flat-spot the drum. A grinding motor can seize. The cheap repair becomes expensive when you wait." },
      { q: "What does it cost to fix a noisy dryer?", a: "Most noise repairs land $200–$300 with parts and labor — rollers, idler, belt, and seal are common together. Motor bearing repairs run higher. The diagnostic confirms which job it is before any work starts." },
      { q: "Why does my dryer get louder as it heats up?", a: "Metal expands and friction increases as parts heat. Worn rollers, dry bearings, and dried-out grease all get noticeably worse once the dryer reaches operating temperature. Classic symptom — and a good diagnostic clue." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee — $50 Quick Check or $100 in-home — applies directly to repair labor if you proceed. You're paying once, not twice." }
    ]
  },
  {
    slug: "dryer-takes-too-long",
    appliance: "dryer",
    title: "Dryer Takes Too Long",
    h1: "Dryer Takes Too Long to Dry",
    metaTitle: "Dryer Takes Too Long to Dry? It's Almost Always the Vent | TN Appliance Exchange",
    metaDesc: "Dryer running two or three cycles to get clothes dry? It's almost always restricted venting — but a real technician will confirm. $50 Quick Check, credited to repair.",
    keywords: "dryer takes too long, dryer not drying, dryer slow, dryer multiple cycles, dryer vent",
    icon: "🌀",
    quickAnswer: "When a dryer takes two or three cycles to dry a normal load, the cause is almost always a restricted vent — packed lint, a crushed transition hose, or a long run with too many bends. The heating element may be working perfectly. A real technician can confirm with a quick check before any parts get swapped.",
    causes: [
      { title: "Clogged vent line", body: "The single biggest cause of long dry times. Lint accumulates over years. Heat can't escape, moisture can't leave, and your clothes sit in a warm humid drum forever." },
      { title: "Crushed or kinked transition hose", body: "The flex hose between the dryer and the wall vent gets crushed when the dryer is pushed back. Half the airflow is gone before the run even starts." },
      { title: "Weak heating element on its way out", body: "An element with a partial break still glows but produces less heat than spec. Times go up gradually until it fails completely." },
      { title: "Failing thermostat or cycling thermostat", body: "If the dryer thinks it's hotter than it is, it'll cycle the heat off too early. The drum is warm but never really hot enough to evaporate moisture quickly." },
      { title: "Overloaded drum", body: "Worth mentioning. Stuffing the drum past capacity cuts air circulation in half. The fix is free — but if loads have been normal and times have grown, the parts side is what we're looking at." }
    ],
    isItWorthFixing: "Almost always — and often the fix is mostly a vent cleaning, not a parts swap. Vent service plus a thermostat is typical $150–$250. Heating element replacement runs $200–$300. The honest answer: don't replace the dryer until someone has confirmed the venting is clear. We've seen brand-new dryers fail because the old vent was never inspected.",
    relatedSymptoms: ["dryer-not-heating", "dryer-smells-like-burning", "dryer-making-noise", "dryer-wont-start"],
    faqs: [
      { q: "Why does my dryer take three cycles to dry one load?", a: "Restricted airflow is the dominant cause. When the vent is packed with lint or the transition hose is kinked, moisture can't escape, so the dryer just keeps running. A weak heating element is the second suspect." },
      { q: "Will cleaning my dryer vent really help?", a: "In most cases, yes — dramatically. A fully clogged vent can double or triple dry times, trip thermal fuses, and shorten the life of every other part. It's the first thing a good technician checks." },
      { q: "How often should I clean my dryer vent?", a: "Once a year for most households. More if you have pets, large family loads, or a long vent run. Energy Star recommends annual cleaning at minimum." },
      { q: "Is my dryer broken or is it the vent?", a: "Until the vent is verified clear, you can't honestly diagnose the dryer. That's why our techs check airflow first. Replacing parts in a machine with a clogged vent just trips the same fuse again." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 Quick Check or $100 in-home diagnostic applies to your repair labor if you proceed. Diagnostic dollars become repair dollars — you pay once." }
    ]
  },
  {
    slug: "dryer-wont-start",
    appliance: "dryer",
    title: "Dryer Won't Start",
    h1: "Dryer Won't Start",
    metaTitle: "Dryer Won't Start or Turn On? Here's What to Check | TN Appliance Exchange",
    metaDesc: "Press start and nothing happens? It's usually the door switch, thermal fuse, or start switch — but it could be the outlet. A real tech rules out each one. $50 Quick Check credited to repair.",
    keywords: "dryer won't start, dryer not turning on, dryer dead, dryer no power, dryer push start",
    icon: "🌀",
    quickAnswer: "A dead dryer is usually one of four things: a tripped breaker, a blown thermal fuse, a failed door switch, or a bad start switch. Most are cheap parts — the savings come from diagnosing the right one. Don't replace a control board before the simpler suspects are ruled out.",
    causes: [
      { title: "Tripped breaker or bad outlet", body: "Electric dryers run on 240V — two hot legs. Lose one and the lights work but the drum won't. The first check is electrical, not the dryer." },
      { title: "Door switch failure", body: "If the switch doesn't register a closed door, the control board kills the start circuit. Cheap part, common failure, easy mistake to overlook." },
      { title: "Blown thermal fuse", body: "Some models won't even power on when the thermal fuse is open. People assume the board is dead. The fuse is $10 — the diagnosis is everything." },
      { title: "Start switch or push-to-start button", body: "The internal contacts wear out over thousands of cycles. You hear the click but nothing engages, or the click is gone entirely." },
      { title: "Control board failure", body: "Real but rare. We rule out everything else first — boards are the most expensive part and the least common failure point." }
    ],
    isItWorthFixing: "Yes — almost always. Switch and fuse repairs are $150–$250 with parts and labor. The math only changes if the control board is gone on a unit older than 12 years where the board is discontinued. The TDR shows both numbers and the honest call.",
    relatedSymptoms: ["dryer-not-heating", "dryer-not-spinning", "dryer-door-wont-close", "dryer-error-codes"],
    faqs: [
      { q: "Why is my dryer completely dead?", a: "Either it's not getting power (breaker, outlet, cord) or an internal safety has tripped (thermal fuse, door switch). A real diagnostic finds the right one in under 15 minutes — and saves you from buying a board you don't need." },
      { q: "Why won't my dryer turn on but the lights work?", a: "On electric dryers this is a classic sign of losing one of the two 240V hot legs — the controls run on 120V from the other leg and stay lit. Test the outlet, then move to internal switches." },
      { q: "Should I just buy a new dryer?", a: "Not before someone has confirmed it's not a $40 part. We've seen too many five-year-old dryers tossed for a bad door switch. Get the honest answer first, then decide." },
      { q: "Can I fix a dryer that won't start myself?", a: "We don't publish step-by-step repair instructions — too much liability with mains voltage and gas. We do tell you exactly which part is broken on the TDR, so if you're confident with appliance repair, you can buy the part from us and install it yourself. Or have us do it." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee applies to repair labor. $50 Quick Check or $100 in-home — both come off your labor cost if you proceed. You pay once." }
    ]
  },
  {
    slug: "dryer-smells-like-burning",
    appliance: "dryer",
    title: "Dryer Smells Like Burning",
    h1: "Dryer Smells Like Burning",
    metaTitle: "Dryer Smells Like Burning? Stop Using It — Here's Why | TN Appliance Exchange",
    metaDesc: "A burning smell from your dryer is a real fire risk. Unplug it and start a Quick Check. We'll tell you exactly what's wrong — most fixes are $200–$300.",
    keywords: "dryer burning smell, dryer smells like fire, dryer smoke, dryer lint fire, dryer overheating",
    icon: "🌀",
    quickAnswer: "A burning smell from a dryer is not normal and it's not something to wait out. It's almost always lint smoldering against the heating element, an overheated motor, or a melted belt rubbing on a stuck part. Unplug the dryer, do not run another cycle, and start a Quick Check today.",
    causes: [
      { title: "Lint smoldering near the heating element", body: "Years of lint accumulation past the trap. Heat plus lint plus stalled airflow is how dryer fires start. This is the most urgent cause and the most preventable." },
      { title: "Overheated motor", body: "A motor straining against a seized drum or restricted airflow can hit insulation-burn temperatures. The smell is acrid and electrical — different from the lint smell." },
      { title: "Burned belt against a stuck drum", body: "If a belt is slipping on a stuck drum it generates serious heat in seconds. You may smell burning rubber before anything else fails." },
      { title: "Failed thermostat letting heat run uncontrolled", body: "Rare but dangerous. When the thermostat fails closed and the safety fuse hasn't blown yet, temperatures climb past spec." },
      { title: "Electrical short or chafed wire", body: "Burning plastic or wire insulation smell. Often points to a worn harness rubbing against a vibrating component." }
    ],
    isItWorthFixing: "It's a question of safety first, then cost. The fix is usually $200–$400 once the underlying cause is found — and the alternative is a potential house fire. Either way, stop using the dryer until it's diagnosed.",
    relatedSymptoms: ["dryer-not-heating", "dryer-takes-too-long", "dryer-error-codes", "dryer-wont-start"],
    faqs: [
      { q: "Is a burning smell from my dryer dangerous?", a: "Yes. Dryer fires are one of the most common appliance-related house fires, and a burning smell is the warning sign before flames. Unplug the unit and do not run another cycle until it's been inspected." },
      { q: "Why does my dryer smell hot?", a: "The most common reasons are accumulated lint past the trap, an overheating motor, a slipping belt, or a stuck thermostat. Each one is a real risk. None of them resolve on their own." },
      { q: "Will cleaning the lint trap fix the burning smell?", a: "It won't fix smoldering lint that's already past the trap — that requires the dryer to be opened and cleaned out properly. A clean trap helps prevent the next buildup, but isn't the fix for an active problem." },
      { q: "How much does it cost to repair a burning-smell dryer?", a: "Most repairs land $200–$400 depending on cause. A deep clean plus a thermostat or fuse swap is the typical bill. The diagnostic confirms what's needed before any quote." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. Pay $50 or $100 once — it becomes credit toward your repair, not a separate bill." }
    ]
  },
  {
    slug: "dryer-door-wont-close",
    appliance: "dryer",
    title: "Dryer Door Won't Close",
    h1: "Dryer Door Won't Close or Stay Latched",
    metaTitle: "Dryer Door Won't Close or Latch? Here's the Fix | TN Appliance Exchange",
    metaDesc: "Dryer door swinging open mid-cycle or refusing to latch? It's usually the strike, catch, or hinge — cheap parts, quick fix. $50 Quick Check credited to repair.",
    keywords: "dryer door won't close, dryer door won't latch, dryer door open, dryer door switch, dryer door catch",
    icon: "🌀",
    quickAnswer: "A dryer door that won't close is almost always a worn strike plate, broken catch, or sagging hinge. On some models the door switch itself fails and the door looks closed but the dryer thinks it's open. Each is a simple part — the diagnostic just confirms which.",
    causes: [
      { title: "Worn or broken door strike/catch", body: "Small plastic pieces that snap together to hold the door. They wear out from thousands of openings. Cheap parts, easy fix." },
      { title: "Sagging or loose hinge", body: "Heavy use over years pulls the hinge mounting screws. The door no longer aligns with the catch. Sometimes it's a screw, sometimes the hinge itself." },
      { title: "Failed door switch", body: "Door closes but the dryer won't start because the switch isn't registering. Diagnosed in 30 seconds with a meter or by listening for the click." },
      { title: "Lint or debris in the strike", body: "Buildup keeps the catch from seating fully. Worth checking before parts get ordered." },
      { title: "Misaligned door seal", body: "Pushes the door out of plane with the catch. Replacement seal restores alignment." }
    ],
    isItWorthFixing: "Always. These are some of the cheapest repairs we do — most run $100–$200 with the Quick Check fee credited. There's no scenario where door hardware makes a dryer not worth fixing.",
    relatedSymptoms: ["dryer-wont-start", "dryer-not-heating", "dryer-error-codes", "dryer-not-spinning"],
    faqs: [
      { q: "Why won't my dryer door stay shut?", a: "Worn strike, broken catch, or a hinge that's gone out of alignment. All three are common and all three are inexpensive parts. The diagnostic identifies which." },
      { q: "Can I run my dryer with the door unlatched?", a: "No. The door switch is a safety interlock — the dryer is designed to shut down when the door isn't fully latched. Running with the door not closing properly will keep tripping the cycle." },
      { q: "How much does a dryer door repair cost?", a: "Most door hardware repairs run $100–$200 with parts and labor. Door switches run similar. Hinge replacements are slightly higher because of access labor on some models." },
      { q: "Is my door switch bad or is the latch bad?", a: "If the door visibly won't stay closed, it's hardware. If the door closes fine but the dryer thinks it's open, it's the switch. A tech checks both in one visit." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 or $100 diagnostic applies to repair labor. You pay once and that money moves forward to the fix." }
    ]
  },
  {
    slug: "dryer-error-codes",
    appliance: "dryer",
    title: "Dryer Error Codes",
    h1: "Dryer Error Codes — What They Mean",
    metaTitle: "Dryer Error Codes Explained — What Each One Means | TN Appliance Exchange",
    metaDesc: "Dryer flashing F01, E60, PF, or AF? Each code points to a specific failure. We translate the code and quote the real repair — diagnostic fee credited.",
    keywords: "dryer error codes, dryer F01, dryer E60, dryer PF code, dryer AF code, dryer fault codes",
    icon: "🌀",
    quickAnswer: "Dryer error codes aren't random — each one points to a specific failure category. F-series codes are usually control or sensor faults. E-series often signal motor or heating issues. PF means power loss. AF means airflow restriction. Tell our tech the brand, model, and code and we'll translate it before any parts get touched.",
    causes: [
      { title: "Sensor or thermistor fault (most F-codes)", body: "Temperature sensors drift or fail open. Cheap part, easy to confirm with a quick test." },
      { title: "Airflow restriction (AF, F70, etc.)", body: "Vent or blower issue. The dryer is smart enough to know it can't dry properly and stops itself." },
      { title: "Motor or drive fault", body: "Some codes report stalled motors, blocked drums, or belt failures. Saves the motor from cooking itself." },
      { title: "Heating circuit fault", body: "Element open, thermostat open, or thermal fuse blown. Code narrows it to a category — the diagnostic confirms which part." },
      { title: "Communication or control board issue", body: "Less common. If sensors and circuits test fine, the brains may be the problem. We rule out the cheap stuff first." }
    ],
    isItWorthFixing: "It depends entirely on what the code translates to. Sensor and fuse-level codes run $150–$250. Motor and board-level codes can climb past $400. We give you the real cost before any work starts so the choice is yours.",
    relatedSymptoms: ["dryer-not-heating", "dryer-not-spinning", "dryer-takes-too-long", "dryer-wont-start"],
    faqs: [
      { q: "What does F01 mean on my dryer?", a: "F01 is typically a control board fault, but the exact meaning varies by brand. Whirlpool, GE, Samsung, and LG each use slightly different code maps. Send us the brand, model, and code and we'll translate it." },
      { q: "Why does my dryer keep showing AF?", a: "AF means airflow fault — the dryer detected restricted venting. The cause is usually a clogged vent line, crushed transition hose, or failing blower. Don't reset and re-run. Get the airflow fixed." },
      { q: "Can I clear a dryer error code myself?", a: "You can reset most codes by unplugging the dryer for a minute. If the underlying problem isn't fixed, the code comes right back. Don't ignore it." },
      { q: "Are error codes always a serious problem?", a: "No — some codes are easy fixes (sensor, fuse, airflow). Others point to bigger jobs (motor, control board). The code itself isn't the problem; it's the diagnostic clue that gets us to the right part fast." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. You pay once." }
    ]
  },

  // ===== WASHER =====
  {
    slug: "washer-not-spinning",
    appliance: "washer",
    title: "Washer Not Spinning",
    h1: "Washer Not Spinning",
    metaTitle: "Washer Won't Spin? It's Usually One of These Three Things | TN Appliance Exchange",
    metaDesc: "Washer drains but won't spin? Clothes still sopping wet? It's almost always the lid switch, drive belt, or motor coupler. $50 Quick Check, credited to repair.",
    keywords: "washer not spinning, washer won't spin, clothes wet after wash, washer lid switch, washer motor coupler",
    icon: "💧",
    quickAnswer: "A washer that drains but won't spin almost always has a failed lid switch (top-loaders), a worn motor coupler or drive belt, or a clutch that's slipped. Front-loaders add door lock and shock-absorber failures to the list. A real technician can rule out each one fast with the model number and a short video.",
    causes: [
      { title: "Failed lid switch or door lock", body: "The single most common cause on top-loaders and front-loaders. Without the switch confirming the door is shut, the spin cycle is blocked entirely." },
      { title: "Worn motor coupler", body: "A small plastic coupling between the motor and transmission. On direct-drive Whirlpool/Kenmore designs this is the classic spin failure — and a known-quick repair." },
      { title: "Stretched or broken drive belt", body: "On belt-drive models, an old belt loses grip and the drum can't reach spin speed. Sometimes you'll hear the motor working hard with little to show for it." },
      { title: "Slipped or worn clutch", body: "On older top-loaders with a true mechanical transmission, the clutch wears down. Symptom is a half-spin or a drum that won't accelerate." },
      { title: "Unbalanced load detection / suspension failure", body: "Front-loaders with worn shock absorbers will sense excessive movement and refuse to spin. The drum is fine; the dampers aren't." }
    ],
    isItWorthFixing: "Almost always. Lid switches and motor couplers run $150–$250. Belt and clutch repairs are similar. Front-loader shock replacement runs $250–$400. Replacement only makes sense on a 12+ year machine with a discontinued transmission or computer board. The TDR shows the math on your specific unit.",
    relatedSymptoms: ["washer-not-draining", "washer-not-filling-with-water", "washer-making-loud-noise", "washer-wont-start"],
    faqs: [
      { q: "Why is my washer not spinning but draining?", a: "When drain works but spin doesn't, the motor and pump are fine — it's a mechanical link to the drum (coupler, belt, clutch) or a safety switch (lid, door) blocking the cycle. The diagnostic narrows it to one." },
      { q: "Why are my clothes still soaking wet?", a: "Spin failure. The drum didn't reach the speed needed to fling water out. Lid switch, coupler, belt, or clutch are the usual suspects. Don't run it on extra spin cycles — you're stressing the same part that's already broken." },
      { q: "How much does it cost to fix a washer that won't spin?", a: "Most spin repairs land $200–$350 with parts and labor. Motor coupler is the cheap end; shock absorbers and transmission rebuilds are the higher end. Brand and model matter — we quote your exact machine." },
      { q: "Is a washer worth fixing if it won't spin?", a: "Yes, in almost every case. The parts are widely available and the labor is straightforward on most models. The only borderline cases are 12+ year old units with discontinued boards." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 or $100 diagnostic applies to repair labor. You pay once, not twice." }
    ]
  },
  {
    slug: "washer-not-draining",
    appliance: "washer",
    title: "Washer Not Draining",
    h1: "Washer Not Draining",
    metaTitle: "Washer Not Draining? It's Almost Always One Thing | TN Appliance Exchange",
    metaDesc: "Standing water in the drum? It's usually a clogged drain pump or a sock in the line. We diagnose, we fix. Quick Check $50 credited to repair.",
    keywords: "washer not draining, washer full of water, washer drain pump, washer clogged drain, water in washer",
    icon: "💧",
    quickAnswer: "A washer that holds water at the end of a cycle almost always has a clogged drain pump, a kinked drain hose, or something jammed in the impeller. Less commonly the pump motor itself fails. Most repairs are $200–$300 once the blockage is cleared and the pump tested.",
    causes: [
      { title: "Clogged drain pump or pump filter", body: "Coins, hairpins, socks, baby socks especially — they collect in the pump and block flow. Front-loaders have an accessible cleanout filter; top-loaders usually require pulling the pump." },
      { title: "Kinked or clogged drain hose", body: "The hose between the washer and the standpipe gets crimped or plugged with lint and detergent residue. Free or cheap fix once it's found." },
      { title: "Foreign object lodged in pump impeller", body: "The pump may spin but produces no flow. Sounds like a normal pump but the water doesn't move." },
      { title: "Failed drain pump motor", body: "The pump just doesn't run. Hum, click, or silence — depending on the failure mode. Pump replacement runs around $200–$300." },
      { title: "Failed lid switch or control fault blocking the drain cycle", body: "The cycle never asks the pump to run. Less common but real, especially on models where the lid switch is also the spin interlock." }
    ],
    isItWorthFixing: "Yes — almost always. Drain pump repairs run $200–$300. If we find a sock, the fix is even cheaper. Replacement only makes sense if other major systems are also failing on a very old machine.",
    relatedSymptoms: ["washer-leaking-water", "washer-not-spinning", "washer-smells-bad", "washer-error-codes"],
    faqs: [
      { q: "Why is my washer full of water and won't drain?", a: "Pump blockage, kinked hose, or pump failure. The diagnostic separates them in minutes. Bail out the drum manually if you need to use the machine cover/move it — and don't keep running cycles." },
      { q: "Can a sock really stop a washer from draining?", a: "Yes — it happens constantly. Small socks slip past the drum gasket and lodge in the pump impeller. Once it's there, the pump can't move water. Removing it is a 15-minute job." },
      { q: "How much does a washer drain pump cost to replace?", a: "Most pump replacements run $200–$300 with parts and labor. The diagnostic confirms whether it's the pump itself or a blockage first — we don't sell pumps you don't need." },
      { q: "Will running a clean cycle fix a clogged drain?", a: "No. A clean cycle removes residue from the drum, not from the pump or drain line. Once water is stuck, no cycle is going to clear it." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fee applies to repair labor. $50 or $100 — paid once, becomes credit toward the fix." }
    ]
  },
  {
    slug: "washer-leaking-water",
    appliance: "washer",
    title: "Washer Leaking Water",
    h1: "Washer Leaking Water",
    metaTitle: "Washer Leaking? Don't Wait — Here's What It Is | TN Appliance Exchange",
    metaDesc: "Water on the floor from your washer is never a 'wait and see' problem. We diagnose the source and quote the real fix. $50 Quick Check, credited to repair.",
    keywords: "washer leaking, washer leaks from bottom, washer leaks from front, washer water on floor, washer hose leak",
    icon: "💧",
    quickAnswer: "Washer leaks come from a short list: fill hoses, drain pump, tub seal, door gasket (front-loaders), or the dispenser drawer. The location of the puddle tells the tech which part to check first. Most repairs run $200–$350 — but waiting turns floor damage into a much bigger bill.",
    causes: [
      { title: "Loose or cracked fill hoses", body: "The most common leak. Hoses swell and crack with age. We always recommend replacing both hoses every 5–7 years as preventive maintenance — they're the leading cause of catastrophic washer floods." },
      { title: "Worn door gasket / bellow (front-loaders)", body: "The rubber boot around the door collects debris and develops mildew or tears. Water seeps out the front during agitation." },
      { title: "Failed tub seal or bearing leak", body: "Water from underneath the tub. Bigger job — often the call where replacement starts to make sense on an older unit." },
      { title: "Dispenser drawer overflow or clog", body: "Detergent buildup blocks the drain back into the tub and water comes out the drawer front. Usually a cleaning, sometimes a part." },
      { title: "Drain pump or drain hose leak", body: "Pump housing cracks, hose clamps loosen, hoses chafe against the cabinet. The puddle location helps narrow it." }
    ],
    isItWorthFixing: "Hoses, gaskets, dispensers, and pumps are all worth fixing — $200–$350 range. The honest gray-area call is a tub seal/bearing leak: the parts are cheap but the labor is significant. On a machine under 8 years old, repair almost always wins. On older units we lay both numbers out and let you decide.",
    relatedSymptoms: ["washer-not-draining", "washer-not-spinning", "washer-smells-bad", "washer-error-codes"],
    faqs: [
      { q: "Why is my washer leaking from the bottom?", a: "Bottom leaks point to pump housing, internal hose connections, or tub seal. Front of the bottom usually means door gasket on a front-loader. Back of the bottom usually means fill hose or drain hose." },
      { q: "Should I keep using a leaking washer?", a: "No. Continued use risks subfloor damage, mold growth, and electrical hazards if water reaches the motor or board. Shut off the supply valves and start a Quick Check." },
      { q: "How much does it cost to fix a leaking washer?", a: "Most leak repairs run $200–$350. Hoses are the cheap end. Door gaskets and pumps are mid-range. Tub seal/bearing jobs are higher. Diagnostic confirms which before quote." },
      { q: "Will replacing the washer hoses prevent leaks?", a: "Yes — for that source. Fill hoses are the #1 cause of catastrophic washer flooding and they cost very little to replace. We swap both when we're there for any related repair." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee applies to repair labor. One payment, not two." }
    ]
  },
  {
    slug: "washer-making-loud-noise",
    appliance: "washer",
    title: "Washer Making Loud Noise",
    h1: "Washer Making Loud Noise",
    metaTitle: "Washer Making Loud Noise? Banging, Grinding, Squealing | TN Appliance Exchange",
    metaDesc: "Each sound from a noisy washer points to a different part. We listen, diagnose, and quote the real fix — $50 Quick Check credited toward your repair.",
    keywords: "washer making noise, washer loud, washer banging, washer grinding, washer squealing, noisy washer spin",
    icon: "💧",
    quickAnswer: "Banging during spin almost always means worn shock absorbers or an unbalanced load. Grinding points to tub bearings or a failing pump. Squealing usually means a drive belt or motor coupler. Front-loaders have different culprits than top-loaders — model matters.",
    causes: [
      { title: "Worn shock absorbers (front-loaders)", body: "The dampers under the tub wear out and the drum bounces during spin. Loud banging that gets worse with full loads. Replacing all four restores stability." },
      { title: "Failing tub bearing", body: "The classic grinding/roaring sound during spin, especially as it ramps up. On older units the cost of bearing replacement vs. a new machine becomes a real conversation." },
      { title: "Drive belt slipping or motor coupler failing", body: "Squeals at start of spin, sometimes accompanied by a burnt smell. Inexpensive parts, easy diagnosis." },
      { title: "Loose or broken spider arm (front-loaders)", body: "The aluminum bracket that holds the drum to the shaft corrodes and breaks. Severe grinding and pounding. Major repair — replacement often makes more sense." },
      { title: "Object lodged in pump or between tub and basket", body: "Coins, hairpins, underwire bras. Random rattle or grinding that comes and goes with cycle phase. Quick fix once located." }
    ],
    isItWorthFixing: "Shocks, belts, couplers, and lodged objects — yes, every time, $200–$350 range. Tub bearings and spider arms are the borderline calls because the labor is heavy. We give you the cost of the repair and the cost of replacement so the choice is honest.",
    relatedSymptoms: ["washer-not-spinning", "washer-drum-wont-turn", "washer-not-draining", "washer-wont-start"],
    faqs: [
      { q: "Why is my washer banging during the spin cycle?", a: "On front-loaders it's almost always worn shock absorbers letting the drum oscillate. On top-loaders it's usually a tub suspension issue or an unbalanced load. Both have clear fixes." },
      { q: "What does a bad washer bearing sound like?", a: "A deep, growing roar or grinding noise during spin — louder as RPM increases. You may also see rust or water marks under the drum. Bearings don't get better with time." },
      { q: "How much does it cost to fix a noisy washer?", a: "Shocks, belts, couplers: $200–$350. Bearings and spider arms: $400–$700, and the conversation may shift toward replacement. The diagnostic gives you the real number before any work." },
      { q: "Is it safe to use a loud washer?", a: "Depends on the cause. A loose object — fine, fix it soon. A grinding bearing or broken spider — no, you'll cascade into bigger damage. The Quick Check tells you which camp you're in." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "washer-not-filling-with-water",
    appliance: "washer",
    title: "Washer Not Filling With Water",
    h1: "Washer Not Filling With Water",
    metaTitle: "Washer Won't Fill With Water? Here's the Most Common Cause | TN Appliance Exchange",
    metaDesc: "Washer not getting water? It's usually the inlet valves, screens, or supply hoses — not the washer itself. We diagnose and quote. Quick Check $50 credited.",
    keywords: "washer not filling, washer no water, washer water inlet valve, washer fill valve, washer supply hose",
    icon: "💧",
    quickAnswer: "A washer that won't fill is almost always a closed supply valve, clogged inlet screens, or a failed water inlet valve. Less often it's the lid switch, pressure sensor, or control board. The fix is rarely expensive once we know which it is.",
    causes: [
      { title: "Closed or partially closed supply valves", body: "The shutoff valves behind the washer. Sometimes a previous repair left them partially closed. Free fix — but you have to find it." },
      { title: "Clogged inlet screens", body: "Tiny screens inside the inlet valve catch sediment from the water supply. They clog over time. A quick clean restores flow." },
      { title: "Failed water inlet valve", body: "The solenoid valve that controls fill. Hot, cold, or both can fail independently. Usually $200–$300 to replace with diagnostic." },
      { title: "Lid switch or door lock not registering closed", body: "Many models won't fill if the safety switch isn't satisfied. Cheap part, common cause." },
      { title: "Pressure switch or sensor failure", body: "The washer thinks it's already full and stops filling. Less common but a known failure on certain models." }
    ],
    isItWorthFixing: "Yes — every scenario. Supply, screen, and switch issues are quick and cheap. Inlet valve replacement runs $200–$300. No fill scenario makes a washer not worth fixing in isolation.",
    relatedSymptoms: ["washer-not-spinning", "washer-not-draining", "washer-wont-start", "washer-error-codes"],
    faqs: [
      { q: "Why is my washer not filling with water?", a: "Most likely a closed supply valve, a clogged inlet screen, or a failed inlet valve. Less often a lid switch or pressure sensor. The diagnostic checks all five quickly." },
      { q: "Can I clean my washer inlet screens myself?", a: "We don't publish step-by-step instructions for liability reasons, but the screens are part of the inlet valve assembly and cleaning them is a known maintenance item. Our techs do it as part of the diagnostic visit if that's the cause." },
      { q: "How much does it cost to fix a washer that won't fill?", a: "Anywhere from no charge (supply valve closed) to about $300 (full inlet valve replacement). Most fills are at the lower end of that range." },
      { q: "Should I replace a washer that won't fill?", a: "Almost never for this symptom alone. The fix is cheap relative to a new machine." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee comes off your repair labor. You only pay once." }
    ]
  },
  {
    slug: "washer-wont-start",
    appliance: "washer",
    title: "Washer Won't Start",
    h1: "Washer Won't Start",
    metaTitle: "Washer Won't Turn On or Start? Common Causes | TN Appliance Exchange",
    metaDesc: "Washer dead, unresponsive, or won't begin a cycle? It's usually power, lid lock, or control board — and we rule out the cheap stuff first. $50 Quick Check.",
    keywords: "washer won't start, washer not turning on, washer dead, washer no power, washer won't begin cycle",
    icon: "💧",
    quickAnswer: "A washer that won't start is usually a power issue, a failed lid lock or door switch, or a control board fault. Boards are the last suspect, not the first. We rule out outlet, breaker, and switches before recommending any expensive parts.",
    causes: [
      { title: "No power at outlet or tripped breaker", body: "The first check, always. Washers have wet feet — GFCI trips happen more than people realize." },
      { title: "Failed door lock (front-loaders) or lid switch (top-loaders)", body: "Without the lock or switch satisfied, the washer won't start the cycle. Common failure, cheap part." },
      { title: "Failed start button or control panel input", body: "Membranes wear out. The button looks fine but isn't making contact. Diagnosed with a meter or by ear." },
      { title: "Bad control board", body: "Real failure but the most expensive — and the rarest. We confirm everything else first." },
      { title: "Failed thermal fuse on certain models", body: "Some washers have a one-shot thermal protection that takes the whole control circuit down when it blows." }
    ],
    isItWorthFixing: "Yes for power, lock, switch, and fuse issues — all $150–$250 range. Control board replacement is the borderline call. We give you both numbers on the TDR.",
    relatedSymptoms: ["washer-not-filling-with-water", "washer-door-wont-open", "washer-error-codes", "washer-not-spinning"],
    faqs: [
      { q: "Why won't my washer turn on at all?", a: "Either it's not getting power (outlet, breaker, cord) or an internal safety has tripped (door lock, thermal fuse, lid switch). We check the cheap suspects first." },
      { q: "Why is my washer making clicking sounds but not starting?", a: "The control board is trying to engage the cycle but a safety isn't satisfied — usually the door lock or lid switch. Click without action usually means a switch isn't reporting closed." },
      { q: "Should I replace a washer that won't start?", a: "Not before someone has confirmed it's not a $30 switch or a tripped breaker. Get the honest answer before deciding." },
      { q: "How much does it cost to fix a washer that won't start?", a: "$150–$250 for switch and fuse repairs. $300–$500 for control board. The diagnostic gets you the real number first." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. The diagnostic fee applies directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "washer-door-wont-open",
    appliance: "washer",
    title: "Washer Door Won't Open",
    h1: "Washer Door Won't Open",
    metaTitle: "Washer Door Stuck Closed? Here's How to Get It Open Safely | TN Appliance Exchange",
    metaDesc: "Front-loader door locked shut? It's usually water in the drum or a failed door lock. We diagnose and fix — Quick Check $50 credited to repair.",
    keywords: "washer door won't open, washer door stuck, front loader door locked, washer door lock failure, washer door release",
    icon: "💧",
    quickAnswer: "A washer door that won't open is usually a stuck door lock, water still in the drum keeping the safety engaged, or a failed lock mechanism. Power-cycle the machine first. If that doesn't work, the lock needs to be released manually or replaced — and the drum needs to drain.",
    causes: [
      { title: "Water remaining in the drum", body: "The safety won't release while water is sensed. Pump or drain may have failed mid-cycle. Drain the water (often via the pump filter) and the lock usually releases." },
      { title: "Failed door lock solenoid", body: "The mechanism that holds the door closed during a cycle is stuck. Most have a manual emergency release tab inside the pump filter compartment." },
      { title: "Broken door handle or latch", body: "Mechanical failure of the handle assembly. Door won't release even when the lock is open. Common part, common failure." },
      { title: "Control board not signaling the lock", body: "Rare, but a fault in the board keeps the lock engaged. Process of elimination after the cheaper suspects." },
      { title: "Mid-cycle interruption from power loss", body: "Some washers will hold the door locked through a brief outage. Power-cycle (unplug 5 min) usually clears it." }
    ],
    isItWorthFixing: "Yes — every time. Door lock and handle repairs are some of the simplest jobs we do. $150–$250 range. Even an emergency manual release in the field is usually a same-day, same-tech fix.",
    relatedSymptoms: ["washer-not-draining", "washer-wont-start", "washer-error-codes", "washer-smells-bad"],
    faqs: [
      { q: "How do I open a washer door that's stuck closed?", a: "Try power-cycling the machine for 5 minutes first. If the drum has water, check the pump filter (usually behind a small panel at the bottom front) — there's often an emergency release cable next to it. Don't force the door — you'll break the handle." },
      { q: "Why is my front-loader door locked after the cycle?", a: "Usually the lock didn't release after the cycle ended — either water sensor still says full, the lock solenoid is stuck, or the board didn't send the release signal. A diagnostic visit identifies which." },
      { q: "Can a washer door open while water is inside?", a: "By design no — it's a safety feature. The lock holds until the drum drains. If your drum can't drain, the lock can't release. That's why drain pump issues often present as 'door stuck' first." },
      { q: "How much does a washer door lock replacement cost?", a: "Most door lock repairs run $200–$300 with parts and labor. The diagnostic confirms it's the lock and not a drainage issue first." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee applies to repair labor. One payment." }
    ]
  },
  {
    slug: "washer-smells-bad",
    appliance: "washer",
    title: "Washer Smells Bad",
    h1: "Washer Smells Bad",
    metaTitle: "Washer Smells Musty or Moldy? Here's the Real Fix | TN Appliance Exchange",
    metaDesc: "Washer smells like mildew? It's almost always the door gasket or pump area on a front-loader. We clean, replace, and prevent. Quick Check $50 credited.",
    keywords: "washer smells bad, washer mildew smell, washer moldy, washer musty smell, washer stinks, front loader smell",
    icon: "💧",
    quickAnswer: "A washer that smells like mildew is almost always biofilm in the door gasket (front-loaders) or buildup in the pump and drain hose. It's not a broken part — it's a maintenance and design issue. Cleaning works for most cases; the gasket itself needs replacing when biofilm has rooted into the rubber.",
    causes: [
      { title: "Biofilm in the door gasket fold (front-loaders)", body: "The single most common cause of washer smell. Water and detergent residue trap in the rubber bellow. Cleaning helps; severely affected gaskets need replacement." },
      { title: "Buildup in the pump filter and drain hose", body: "Lint, hair, and detergent residue collect at the pump. The smell comes from biofilm down there too. Cleaning the pump filter is part of routine maintenance." },
      { title: "Detergent residue in the tub and dispenser", body: "Using too much HE detergent, or non-HE detergent in an HE machine, leaves residue that ferments. Often fixed by switching detergent and running clean cycles." },
      { title: "Standing water in the boot or pump area", body: "Some installation issues leave water trapped at the lowest point. Sloped install or a small drainage tweak resolves it." },
      { title: "Mold growth on the inside of the tub", body: "Rarer but real. Persistent damp environment lets mold colonize the drum interior. Full cleaning treatment + behavior changes (leaving door open between loads) resolves it." }
    ],
    isItWorthFixing: "Always — and often the fix is cheap. A pump filter clean + gasket cleaning is sometimes free at the diagnostic visit. Gasket replacement runs $200–$400 depending on model. There's no scenario where smell makes a washer not worth fixing.",
    relatedSymptoms: ["washer-leaking-water", "washer-not-draining", "washer-error-codes", "washer-drum-wont-turn"],
    faqs: [
      { q: "Why does my front-loader washer smell like mildew?", a: "Biofilm in the door gasket and pump filter. It's the design's main weakness — water trapped in the rubber bellow and pump area becomes a breeding ground. Regular cleaning prevents it; severe cases need a new gasket." },
      { q: "How do I get rid of washer smell?", a: "Clean the gasket fold thoroughly, run a tub clean cycle with a washer cleaner, and clean the pump filter. Leave the door open between loads to let the drum dry. If smell persists after that, the gasket itself may be soaked through." },
      { q: "Will replacing the gasket fix the smell?", a: "Usually yes — when biofilm has rooted into the rubber, cleaning won't reach all the way. New gasket plus better post-load habits gets you back to a clean machine." },
      { q: "How much does it cost to fix a smelly washer?", a: "Cleaning service is usually under $150. Door gasket replacement runs $200–$400 depending on model. Diagnostic covers both options before any work." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "washer-error-codes",
    appliance: "washer",
    title: "Washer Error Codes",
    h1: "Washer Error Codes — What They Mean",
    metaTitle: "Washer Error Codes Explained — Find Your Code | TN Appliance Exchange",
    metaDesc: "Washer flashing LE, UE, F21, dE, or E1? Each code points to a specific failure. Tell us your brand, model, and code — we'll translate it. Diagnostic fee credited.",
    keywords: "washer error codes, washer LE code, washer UE code, washer F21, washer dE, washer fault codes",
    icon: "💧",
    quickAnswer: "Each washer brand has its own error code map. LG uses LE/UE/dE. Samsung uses 4E/5E/SC. Whirlpool/Maytag/Kenmore use F-series codes. Each one points to a category — motor, drain, door, balance — and the specific fix depends on brand and model. Send us the code and a photo and we'll translate.",
    causes: [
      { title: "Motor or stator faults (LE on LG, F-series on Whirlpool)", body: "Failed Hall sensor, motor coil, or stator. Sometimes a magnet shifts and the sensor misreads RPM." },
      { title: "Drain or pump faults (5E on Samsung, F21 on Whirlpool)", body: "Pump can't drain in time. Blockage, kinked hose, or pump failure." },
      { title: "Door lock faults (dE on LG/Samsung)", body: "Door lock not engaging or not reporting closed to the control board." },
      { title: "Imbalance / level faults (UE)", body: "Drum can't balance during spin. Could be loading, suspension, or sensor." },
      { title: "Water level or fill faults", body: "Pressure switch, sensor, or inlet valve issues." }
    ],
    isItWorthFixing: "Depends on which code. Sensor, pump, lock, and switch repairs are all $150–$300 range. Motor faults on direct-drive models climb past $400. We translate the code to a real cost before anything gets swapped.",
    relatedSymptoms: ["washer-not-spinning", "washer-not-draining", "washer-door-wont-open", "washer-wont-start"],
    faqs: [
      { q: "What does LE mean on my LG washer?", a: "LE on LG washers is a motor/locked rotor error. The drum is stalled or the Hall sensor is misreading. Could be a stuck object, a failed sensor, or a bad motor. Diagnostic narrows it." },
      { q: "What does UE mean on my washer?", a: "UE is an unbalanced load error. Usually the load itself, but if it happens repeatedly with normal loads, the suspension or shock absorbers need attention." },
      { q: "Why does my Samsung washer say 4E or 5E?", a: "4E is a water inlet error (no fill). 5E is a drain error (water won't go out). Each points to a specific path — fill valve, supply, screens on 4E; pump, hose, filter on 5E." },
      { q: "Can I just clear the error and keep using the washer?", a: "Sometimes for a single bad load, yes. If the code keeps coming back, the underlying problem isn't going away on its own. Get the real diagnosis." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees become repair credit. You only pay once." }
    ]
  },
  {
    slug: "washer-drum-wont-turn",
    appliance: "washer",
    title: "Washer Drum Won't Turn",
    h1: "Washer Drum Won't Turn",
    metaTitle: "Washer Drum Stuck or Won't Turn? Here's What's Wrong | TN Appliance Exchange",
    metaDesc: "Washer fills but the drum won't move? It's almost always the motor coupler, belt, or motor. Honest diagnostic, real pricing. Quick Check $50 credited.",
    keywords: "washer drum won't turn, washer drum stuck, washer drum not moving, washer agitator broken, washer motor coupler",
    icon: "💧",
    quickAnswer: "A washer that fills with water but the drum won't move is almost always a broken motor coupler (direct-drive), a snapped drive belt, or a failed motor. Top-loaders may have a failed agitator dogs or transmission. Each one is a known fix at a known cost.",
    causes: [
      { title: "Broken motor coupler (direct-drive top-loaders)", body: "Whirlpool/Kenmore classic failure. Small plastic coupling between motor and transmission shears. Cheap part, real labor — well-known repair." },
      { title: "Snapped or stretched drive belt", body: "On belt-drive models. The motor runs but the drum doesn't move. Visible inspection confirms quickly." },
      { title: "Failed agitator dogs or coupler (top-loaders)", body: "Wash works but the agitator clicks instead of grabbing. The dogs wear down with use." },
      { title: "Seized motor", body: "Motor won't start at all. May hum and trip the thermal protector. Usually a major repair conversation." },
      { title: "Broken transmission (older top-loaders)", body: "The gearbox between motor and tub. Rare but terminal — at this point we're discussing replacement honestly." }
    ],
    isItWorthFixing: "Coupler, belt, agitator dogs — yes, every time, $200–$300. Motor replacement is borderline depending on machine. Transmission failure is usually the call where replacement wins on older units. The TDR shows both numbers so you can decide.",
    relatedSymptoms: ["washer-not-spinning", "washer-making-loud-noise", "washer-wont-start", "washer-error-codes"],
    faqs: [
      { q: "Why does my washer fill but the drum won't move?", a: "The fill circuit and the motor circuit are independent. Fill works, motor or mechanical linkage doesn't. Coupler, belt, or motor are the suspects." },
      { q: "What is a washer motor coupler?", a: "On direct-drive washers it's a small plastic part that connects the motor to the transmission. It's designed to break before more expensive parts — and it's a common, cheap repair." },
      { q: "How much to repair a washer drum that won't turn?", a: "$200–$300 for the common coupler/belt jobs. $400+ for motor replacement. We diagnose first and quote the real number." },
      { q: "Is my washer transmission broken?", a: "Possible but rare. We rule out coupler, belt, and motor first. Transmission failure usually shows up as a different kind of noise and a different failure mode than 'won't turn at all.'" },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic applies to repair labor. One payment, not two." }
    ]
  },

  // ===== REFRIGERATOR =====
  {
    slug: "refrigerator-not-cooling",
    appliance: "refrigerator",
    title: "Refrigerator Not Cooling",
    h1: "Refrigerator Not Cooling",
    metaTitle: "Refrigerator Not Cooling? Here's What's Probably Happening | TN Appliance Exchange",
    metaDesc: "Fridge warm but freezer fine? Or both warm? Each scenario points to a different fix. We diagnose honestly — $50 Quick Check, credited to repair.",
    keywords: "refrigerator not cooling, fridge not cold, refrigerator warm, fridge stopped cooling, refrigerator compressor",
    icon: "🧊",
    quickAnswer: "When a refrigerator stops cooling but the freezer still works, the cause is almost always frost-blocked evaporator coils, a failed defrost system, or a stuck damper. When both compartments are warm, it's usually a sealed system issue (compressor, refrigerant) or a control board fault. Each path has very different cost implications — get a real diagnosis before deciding anything.",
    causes: [
      { title: "Frosted-over evaporator coils", body: "When the defrost system fails, frost builds on the coils until air can't circulate. The freezer stays cold (right next to the coils) but the fridge section warms. Most common cause." },
      { title: "Failed evaporator fan or condenser fan", body: "Without airflow, cold doesn't move where it needs to go. You may hear the fan trying to spin against ice, or hear silence where you should hear airflow." },
      { title: "Stuck or broken damper between compartments", body: "Some models use a motorized damper to control cold flow into the fresh food side. When it fails closed, the fridge warms while the freezer stays cold." },
      { title: "Dirty condenser coils", body: "Years of dust and pet hair on the back/bottom coils reduce heat exchange. The compressor runs constantly but can't keep up. Free or cheap fix — and missed surprisingly often." },
      { title: "Sealed system failure (compressor, refrigerant leak)", body: "The big one. Compressor failure or refrigerant leak. The cost conversation changes here — this is where 'should I replace it' becomes a real question." }
    ],
    isItWorthFixing: "Frost, fan, damper, and coil issues — yes every time, $200–$450 range. Sealed system repairs (compressor, refrigerant) start around $800 and run past $2,000 depending on the system. On older units (10+ years) sealed system failures are often the call where replacement wins. We give you both numbers honestly — no pressure either way.",
    relatedSymptoms: ["refrigerator-making-noise", "refrigerator-leaking-water", "refrigerator-freezing-food", "freezer-not-freezing"],
    faqs: [
      { q: "Why is my refrigerator warm but freezer cold?", a: "Almost always a defrost system failure, a broken evaporator fan, or a stuck damper. Cold can't move from the freezer (where it's being made) into the fridge section. Usually a $200–$400 fix." },
      { q: "How long does a refrigerator last?", a: "Most modern fridges run 10–15 years. Older units (Maytag, Whirlpool side-by-sides from the 90s) often last 20+ with proper maintenance. Age alone isn't the deciding factor — parts availability and what's broken matter more." },
      { q: "Is it worth fixing a refrigerator that won't cool?", a: "Usually yes — most causes are non-sealed-system repairs in the $200–$450 range. The honest gray-area call is a sealed system failure (compressor, refrigerant) which can hit $800–$2,000 and is where replacement often makes more sense." },
      { q: "Should I unplug a fridge that's not cooling?", a: "Yes if water is leaking or you suspect electrical issues. Otherwise, leave it running while you transfer food to coolers — it can sometimes recover after a defrost. Get the diagnostic before anything else." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. The diagnostic fee — $50 Quick Check or $100 in-home — applies directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "refrigerator-making-noise",
    appliance: "refrigerator",
    title: "Refrigerator Making Noise",
    h1: "Refrigerator Making Noise",
    metaTitle: "Refrigerator Making Noise? Buzzing, Clicking, Knocking | TN Appliance Exchange",
    metaDesc: "Each fridge sound points to a different part. Buzzing, clicking, knocking — we diagnose the cause and quote the real fix. Quick Check $50 credited.",
    keywords: "refrigerator making noise, fridge loud, fridge buzzing, refrigerator clicking, fridge knocking, noisy refrigerator",
    icon: "🧊",
    quickAnswer: "Each fridge sound points to a different part. Clicking on/off is usually the start relay (cheap fix). Loud buzzing is often a failing compressor or evap fan hitting ice. Knocking is typically the defrost timer or ice maker. Each one is diagnosable in a single visit.",
    causes: [
      { title: "Start relay clicking", body: "The relay that kicks the compressor on/off. When it fails, you'll hear a click-click-click pattern. Cheap part, common failure." },
      { title: "Evaporator fan hitting ice", body: "Buildup from a failing defrost system. The fan grinds against ice. Defrost the unit and fix the underlying defrost issue." },
      { title: "Condenser fan obstruction", body: "Lint or debris in the fan on the back/bottom. Easy fix when found." },
      { title: "Failing compressor", body: "Deep buzz that increases over time. Sometimes the bearings whine. This is the call where replacement is on the table." },
      { title: "Ice maker cycling normally", body: "Sometimes the noise is just the ice maker doing its job. We rule this in or out fast." }
    ],
    isItWorthFixing: "Start relay, fan, defrost, ice maker — all worth fixing, $150–$400. Compressor is the borderline call. We always quote both.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-leaking-water", "freezer-not-freezing", "ice-maker-not-working"],
    faqs: [
      { q: "Why is my refrigerator making a clicking sound?", a: "Almost always the compressor start relay. It tries to engage the compressor, can't, releases, tries again. Usually a $150–$250 repair." },
      { q: "Is a buzzing refrigerator dangerous?", a: "Not immediately, but it usually means a fan is hitting ice or a compressor is straining. Both get worse — and one of them ends as a sealed-system failure." },
      { q: "When should I worry about fridge noise?", a: "When it's new, getting louder, or changing pattern. Steady gentle hum is normal. Anything else warrants a diagnostic." },
      { q: "How much does it cost to fix a noisy fridge?", a: "Start relay $150–$250. Fan replacement $200–$350. Defrost system $300–$450. Compressor $800+. The diagnostic gets you the real number before any work." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic applies to repair labor — one payment, not two." }
    ]
  },
  {
    slug: "refrigerator-leaking-water",
    appliance: "refrigerator",
    title: "Refrigerator Leaking Water",
    h1: "Refrigerator Leaking Water",
    metaTitle: "Refrigerator Leaking Water? Here's Where It's Coming From | TN Appliance Exchange",
    metaDesc: "Puddle under the fridge? Water inside the drawers? Each leak source has a specific fix. Quick Check $50 credited toward your repair.",
    keywords: "refrigerator leaking water, fridge leaks, water under refrigerator, fridge water line leak, defrost drain clogged",
    icon: "🧊",
    quickAnswer: "Water on the floor is almost always a clogged defrost drain, a cracked water line to the ice maker, or a failed water filter housing. Water inside the crisper drawers usually means a clogged defrost drain dripping into the fresh food side. Each is a known fix at a known cost.",
    causes: [
      { title: "Clogged defrost drain", body: "The drain that carries melted frost away gets blocked by food debris or ice. Water backs up and drips into the fridge or onto the floor. Cleanout is straightforward." },
      { title: "Cracked or pinched water supply line", body: "The plastic line feeding the ice maker and dispenser. Cracks at fittings or pinches behind the fridge cause slow drips that puddle." },
      { title: "Failed water filter housing", body: "O-rings or housing cracks after years. Water filter changes can sometimes trigger leaks if the new filter isn't seated right." },
      { title: "Ice maker overflow or stuck fill valve", body: "Fill valve doesn't shut off. Water keeps going into the ice maker tray and overflows. Eventually puddles outside." },
      { title: "Damaged or sweating door gasket", body: "Worn gaskets let humid air in. Condensation forms and runs down the inside. Replacement restores the seal." }
    ],
    isItWorthFixing: "Yes — every scenario. Drains, water lines, filters, and valves all run $150–$300. Gasket replacement runs $200–$350. None of these are the kind of failures that make a fridge not worth fixing.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-door-seal-broken", "ice-maker-leaking", "refrigerator-not-making-ice"],
    faqs: [
      { q: "Why is my refrigerator leaking water from the bottom?", a: "Most common cause is a clogged defrost drain — water that should drain into the evaporation pan backs up and runs out the bottom of the freezer. Second most common is a cracked water supply line. Both are straightforward to diagnose." },
      { q: "Why is there water inside my crisper drawer?", a: "Defrost drain is clogged. Melt water from the freezer is being redirected into the fridge section. Until the drain is cleared, it'll keep happening." },
      { q: "How much does it cost to fix a leaking refrigerator?", a: "$150–$300 for most leak repairs. Defrost drain clearing is the cheap end. Full water valve or filter housing replacement is the middle." },
      { q: "Should I keep using a leaking fridge?", a: "Short term yes — but get it diagnosed. Continued leaks risk floor damage and electrical hazards if water reaches the compressor." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. The diagnostic fee applies to repair labor. You only pay once." }
    ]
  },
  {
    slug: "refrigerator-freezing-food",
    appliance: "refrigerator",
    title: "Refrigerator Freezing Food",
    h1: "Refrigerator Freezing Food in the Fridge Section",
    metaTitle: "Refrigerator Freezing Food in the Fridge? Here's Why | TN Appliance Exchange",
    metaDesc: "Lettuce frozen, milk slushy, vegetables solid? Your fridge is running too cold. Damper, thermistor, or thermostat — we diagnose. Quick Check $50 credited.",
    keywords: "refrigerator freezing food, fridge too cold, refrigerator damper, fridge thermistor, refrigerator running cold",
    icon: "🧊",
    quickAnswer: "When the fridge section freezes food, the cause is almost always a stuck damper (letting too much cold in from the freezer), a failed thermistor giving wrong temperature readings, or a thermostat set too cold or failing closed. Each is a focused diagnostic and a known repair.",
    causes: [
      { title: "Stuck-open damper", body: "The motorized damper between freezer and fridge is stuck letting cold air through constantly. Fresh food section runs at freezer temps." },
      { title: "Failed thermistor", body: "Temperature sensor reports warmer than actual. Control board thinks the fridge needs more cooling and overdoes it. Cheap part, big symptom." },
      { title: "Thermostat set too cold", body: "Worth checking before parts get ordered. Sometimes someone bumped the dial." },
      { title: "Failed temperature control board", body: "If the board is misreading or stuck calling for cool, the cooling never stops. Diagnosed after cheaper suspects." },
      { title: "Damaged door gasket pulling in too much humid air", body: "Less common cause but creates frost issues that present as 'food freezing.'" }
    ],
    isItWorthFixing: "Yes. Damper, thermistor, thermostat repairs all $150–$350. Control board replacement is the higher end. None of these make a fridge not worth fixing on their own.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-door-seal-broken", "freezer-not-freezing", "refrigerator-making-noise"],
    faqs: [
      { q: "Why is my refrigerator freezing food?", a: "Almost always a stuck damper or a failed temperature sensor. The fridge is being told to cool more than it should, or cold air from the freezer is flowing into the fresh food section unchecked." },
      { q: "Can I fix a fridge that's too cold by adjusting the temperature?", a: "Sometimes — start there. If the dial is on the coldest setting, dial it back. If adjustment doesn't help within 24 hours, you've got a real failure (damper, thermistor, or board)." },
      { q: "How much does it cost to fix a fridge freezing food?", a: "$150–$350 for damper or thermistor. Higher for control board. Diagnostic confirms the exact part before any work." },
      { q: "Will my food spoil if I keep using a fridge that's freezing?", a: "Some foods are ruined when frozen (lettuce, eggs, milk, condiments). Others are fine. Get the diagnostic and a fix — don't try to compensate by setting the dial warmer; you'll just hide the underlying problem." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fee applies to repair labor. One payment." }
    ]
  },
  {
    slug: "refrigerator-door-seal-broken",
    appliance: "refrigerator",
    title: "Refrigerator Door Seal Broken",
    h1: "Refrigerator Door Seal Broken or Worn",
    metaTitle: "Refrigerator Door Seal Failing? Symptoms and Fix | TN Appliance Exchange",
    metaDesc: "Fridge seal letting cold air out? Frost on the inside, condensation outside, motor running constantly. We replace gaskets. Quick Check $50 credited.",
    keywords: "refrigerator door seal, fridge gasket, refrigerator door not sealing, fridge door gasket replacement",
    icon: "🧊",
    quickAnswer: "A failing fridge door seal shows up as condensation on the outside, frost on the inside, and a compressor that runs almost constantly trying to keep up. Replacement is straightforward and usually $200–$350. Don't tolerate a bad seal — your electric bill and your food are paying for it.",
    causes: [
      { title: "Aged or cracked gasket", body: "Rubber dries out and loses springiness. Won't seal flat anymore. Replacement gasket restores the seal." },
      { title: "Twisted or warped gasket from heavy use", body: "Years of opening and closing twist the gasket out of plane. Sometimes a careful heating and reshaping works; usually replacement is the answer." },
      { title: "Damaged door alignment", body: "Door hinges sag, throwing the gasket out of contact with the cabinet. Adjusting the hinge restores seal pressure." },
      { title: "Food debris in the seal channel", body: "Crumbs, condiment drips. Cleaning sometimes solves what looked like a gasket failure." },
      { title: "Broken or missing closer cam (some models)", body: "Cam mechanism in the hinge that pulls the door closed at the last inch. When it breaks, the door hangs slightly open." }
    ],
    isItWorthFixing: "Yes — every time. Gasket replacement is one of the more straightforward repairs and pays back through energy savings and longer compressor life.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-freezing-food", "refrigerator-making-noise", "refrigerator-smells-bad"],
    faqs: [
      { q: "How do I know if my fridge door seal is bad?", a: "Slide a dollar bill between the door and cabinet and close it. If you can pull it out easily, the seal is failing. Add visual checks for cracks, tears, or warping." },
      { q: "Can I replace a fridge door gasket myself?", a: "We don't publish step-by-step instructions, but it's a known DIY-friendly repair on most models. Get the model number on the TDR and you can buy the right gasket from us. Or have us install it." },
      { q: "How much does it cost to replace a refrigerator door seal?", a: "Most replacements run $200–$350 with parts and labor. Gasket price varies widely by brand and model — high-end built-in fridges can be $400+ for the gasket alone." },
      { q: "Will a bad gasket ruin my fridge?", a: "Over time, yes. The compressor runs harder, the defrost system works overtime, and frost builds up where it shouldn't. Fixing the seal is cheap insurance." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. The diagnostic fee applies directly to repair labor. One payment." }
    ]
  },
  {
    slug: "refrigerator-smells-bad",
    appliance: "refrigerator",
    title: "Refrigerator Smells Bad",
    h1: "Refrigerator Smells Bad",
    metaTitle: "Refrigerator Smells Bad? It's Not Always the Food | TN Appliance Exchange",
    metaDesc: "Cleaning didn't fix the smell? Look at the defrost drain, evaporation pan, and gasket biofilm. We diagnose and fix odd fridge smells.",
    keywords: "refrigerator smells, fridge bad smell, refrigerator stinks, fridge mold smell, drain pan smell",
    icon: "🧊",
    quickAnswer: "A fridge that smells bad after cleaning usually has dirty water in the evaporation pan, a slow-rotting defrost drain, or biofilm in the door gasket. Less commonly the issue is a dead mouse behind the back panel or food debris in the fan housing. Each one is a real fix.",
    causes: [
      { title: "Dirty evaporation pan", body: "The pan under the fridge collects defrost water. After years it grows biofilm and slime. Out of sight, out of mind — and persistently smelly." },
      { title: "Clogged defrost drain holding water", body: "Stagnant water in the drain line ferments. The smell wafts through the cold air supply." },
      { title: "Biofilm in the door gasket", body: "Same problem as washers — biofilm in the rubber. Cleaning the fold helps; severely affected gaskets need replacement." },
      { title: "Food debris in fan or duct", body: "A pea that fell behind the back panel. A piece of cheese in the freezer ducts. Both create a smell the casual cleaner can't find." },
      { title: "Dead pest in the coils or cabinet", body: "Less pleasant but real. Mice get into the warm motor compartment and don't always make it out." }
    ],
    isItWorthFixing: "Always — and often the fix is cheap. Pan cleaning + drain clear is a routine maintenance visit. Gasket cleaning or replacement runs the high end. No scenario where smell makes a fridge not worth fixing.",
    relatedSymptoms: ["refrigerator-leaking-water", "refrigerator-door-seal-broken", "refrigerator-not-cooling", "refrigerator-not-making-ice"],
    faqs: [
      { q: "Why does my refrigerator smell bad even after cleaning?", a: "Because the smell source is usually behind the back panel (drain pan, defrost drain) or in the door gasket — not on the shelves. Surface cleaning misses it." },
      { q: "How do I clean a refrigerator drain pan?", a: "Most pans require pulling the kick panel off and either sliding the pan out or vacuuming it in place. We don't publish step-by-step DIY because each model is different — but we'll service it during the diagnostic visit." },
      { q: "Will replacing the gasket fix a fridge smell?", a: "If the smell traces to the gasket (mildew/biofilm odor when you open the door), yes. If the smell is general/musty when the fridge is running, it's more likely the drain or pan." },
      { q: "How much does it cost to service a smelly fridge?", a: "Typically $150–$300 for cleaning/drain service. Higher if a gasket needs replacement." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "refrigerator-not-making-ice",
    appliance: "refrigerator",
    title: "Refrigerator Not Making Ice",
    h1: "Refrigerator Not Making Ice",
    metaTitle: "Refrigerator Not Making Ice? Here's the Real Reason | TN Appliance Exchange",
    metaDesc: "No ice or slow ice? It's usually the water line, fill valve, or ice maker module. We diagnose the right one. Quick Check $50 credited to your repair.",
    keywords: "refrigerator not making ice, ice maker broken, fridge ice maker not working, water line ice maker, ice maker module",
    icon: "🧊",
    quickAnswer: "An ice maker that's stopped producing usually has a frozen water line, a failed water inlet valve, a clogged water filter, or a dead ice maker module. Less often the freezer temperature is wrong. Each one is diagnosable in a single visit.",
    causes: [
      { title: "Frozen water line", body: "Most common. The plastic line freezes inside the freezer and water can't reach the mold. Thawing it + finding why it froze (low water pressure, kinked line, freezer too cold) fixes the loop." },
      { title: "Failed water inlet valve", body: "The solenoid that lets water into the ice maker. When it fails the mold never fills. $200–$300 repair." },
      { title: "Clogged or expired water filter", body: "Restricted flow can starve the ice maker. Replace or bypass and retest." },
      { title: "Dead ice maker module/motor", body: "The internal motor that ejects ice and runs the cycle. Replacement modules run $250–$400 with labor." },
      { title: "Freezer temperature too warm", body: "Ice makers need a freezer below about 0°F to cycle. If the freezer is borderline, ice production stalls. Address the freezer first." }
    ],
    isItWorthFixing: "Yes for water line, valve, filter, and module — all $200–$400 range. The honest gray-area call is a control board failure on a 10+ year old fridge where the board is discontinued. We'll tell you straight.",
    relatedSymptoms: ["ice-maker-not-working", "ice-maker-leaking", "refrigerator-leaking-water", "refrigerator-not-cooling"],
    faqs: [
      { q: "Why is my refrigerator not making ice anymore?", a: "Frozen water line, failed inlet valve, clogged filter, or a dead ice maker module. The order matters — line and filter first, then valve, then module." },
      { q: "How long does an ice maker last?", a: "Typically 5–10 years. Components inside the module wear out — particularly the motor and the thermostat that triggers the harvest cycle. Replacement modules are widely available." },
      { q: "How much does it cost to fix an ice maker?", a: "Water line thaw is the cheap end — sometimes under $150. Module replacement runs $250–$400. Full sealed system isn't the cause of ice maker failures." },
      { q: "Can I bypass the water filter to test?", a: "On most models, yes — there's a bypass cap that lets the fridge work without a filter. Run it for 24 hours with the bypass; if ice resumes, the filter was the cause." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. You pay once." }
    ]
  },

  // ===== FREEZER + ICE MAKER =====
  {
    slug: "freezer-not-freezing",
    appliance: "freezer",
    title: "Freezer Not Freezing",
    h1: "Freezer Not Freezing",
    metaTitle: "Freezer Not Freezing? Here's What's Probably Wrong | TN Appliance Exchange",
    metaDesc: "Freezer warm or soft food? It's usually defrost, fan, or door seal — sealed system is the last suspect. Quick Check $50 credited.",
    keywords: "freezer not freezing, freezer warm, freezer not cold enough, freezer defrost system, stand-up freezer not freezing",
    icon: "❄️",
    quickAnswer: "A freezer that won't freeze is almost always a failed defrost system (frost-blocked coils), a dead evaporator fan, or a worn door seal letting in warm air. Sealed system failures (compressor, refrigerant) are real but rare — and the most expensive call. Get diagnosed before assuming the worst.",
    causes: [
      { title: "Defrost system failure", body: "Defrost heater, timer, or thermostat fails. Frost builds on coils until air can't move. Freezer warms over days." },
      { title: "Evaporator fan failure", body: "Cold air isn't circulating. Coils may be cold but freezer is warm." },
      { title: "Worn door gasket", body: "Continuous warm air ingress overwhelms the cooling. Cheap fix, big impact." },
      { title: "Dirty condenser coils", body: "Heat exchange compromised. Compressor runs constantly but can't keep up." },
      { title: "Sealed system failure", body: "Compressor or refrigerant. The big-ticket call." }
    ],
    isItWorthFixing: "Defrost, fan, gasket, coils — yes, $200–$450. Sealed system is the borderline call, often where replacement wins on older units.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-door-seal-broken", "ice-maker-not-working", "refrigerator-making-noise"],
    faqs: [
      { q: "Why is my freezer not freezing?", a: "Most likely a defrost issue, a fan failure, or a worn door seal. Sealed system is possible but rare — and we rule out the cheap suspects first." },
      { q: "Can a freezer be repaired or do I just buy a new one?", a: "Most freezer failures are repairable in the $200–$450 range. Sealed system failures are the gray-area call where replacement may win, especially on units 12+ years old." },
      { q: "Why is my stand-up freezer not freezing but still humming?", a: "Compressor is running but cold isn't being generated or distributed. Defrost, fan, or sealed system — diagnostic narrows it." },
      { q: "How long should I wait before calling someone?", a: "If food is thawing, don't wait. The longer you run a failing system, the worse the damage to the compressor." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee — $50 or $100 — applies directly to repair labor. One payment, not two." }
    ]
  },
  {
    slug: "ice-maker-not-working",
    appliance: "ice maker",
    title: "Ice Maker Not Working",
    h1: "Ice Maker Not Working",
    metaTitle: "Ice Maker Not Working? Here's the Real Reason | TN Appliance Exchange",
    metaDesc: "Empty ice bin and no production? Water line, fill valve, or module. We rule out the right one — Quick Check $50 credited to repair.",
    keywords: "ice maker not working, ice maker broken, ice maker stopped, ice maker no water, ice maker module",
    icon: "❄️",
    quickAnswer: "An ice maker that's not working usually has a frozen supply line, a failed water valve, a clogged filter, or a dead ice maker module. Less often the freezer is too warm or the ice maker's own control was switched off. Each one is a quick diagnostic.",
    causes: [
      { title: "Frozen water line in the freezer", body: "The most common cause. Water freezes inside the supply line before it reaches the ice maker mold." },
      { title: "Failed water inlet valve", body: "The solenoid that controls water flow to the ice maker. When it fails the mold never fills." },
      { title: "Clogged water filter", body: "Restricted flow starves the ice maker. Replace the filter and retest." },
      { title: "Failed ice maker module", body: "The motor and thermostat assembly that cycles the maker. Modules wear out at 5–10 years." },
      { title: "Ice maker arm in 'off' position", body: "Worth checking — the wire arm has been bumped up to 'off.' Free fix." }
    ],
    isItWorthFixing: "Yes — every cause is in the $150–$400 range. Module replacements are the upper end.",
    relatedSymptoms: ["refrigerator-not-making-ice", "ice-maker-leaking", "refrigerator-leaking-water", "freezer-not-freezing"],
    faqs: [
      { q: "Why is my ice maker not making ice?", a: "Frozen line, bad valve, clogged filter, or dead module — those four account for almost every case. Diagnostic separates them fast." },
      { q: "How do I reset an ice maker?", a: "Most have a reset button or arm. We don't publish step-by-step because reset procedures vary by brand and model — and a reset only helps if the underlying issue is transient. If it's a hardware failure, the reset just confirms it." },
      { q: "How long does an ice maker last?", a: "5–10 years for the module itself. The valve, line, and filter components have similar lifespans. Replacement parts are widely available." },
      { q: "How much does it cost to fix an ice maker?", a: "$150–$400 typical range. Water line work is the cheap end. Module replacement is the upper end." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "ice-maker-leaking",
    appliance: "ice maker",
    title: "Ice Maker Leaking",
    h1: "Ice Maker Leaking",
    metaTitle: "Ice Maker Leaking Water? Fix It Before It Damages the Floor | TN Appliance Exchange",
    metaDesc: "Ice maker dripping or overflowing? Usually the fill valve or water line. We diagnose fast. Quick Check $50 credited to your repair.",
    keywords: "ice maker leaking, ice maker overflowing, ice maker water leak, fill valve leak, ice maker water line",
    icon: "❄️",
    quickAnswer: "An ice maker that leaks is almost always a stuck-open water valve, a cracked supply line, a misaligned mold causing overflow, or a failed shutoff switch. Catch it early — water on the floor turns into subfloor damage fast.",
    causes: [
      { title: "Stuck water inlet valve", body: "Valve doesn't close fully. Water keeps trickling in. Mold overflows or line backflows." },
      { title: "Cracked water supply line", body: "Plastic line fails at a fitting or where it's been pinched. Slow drip that puddles." },
      { title: "Misaligned ice maker mold", body: "Cubes don't sit flat in the mold. Water spills over the side as the maker fills." },
      { title: "Failed shutoff switch or full sensor", body: "Ice maker doesn't know when to stop. Keeps cycling and overflowing." },
      { title: "Worn or missing fill cup", body: "The small plastic part that funnels water into the mold. When it goes, water sprays sideways." }
    ],
    isItWorthFixing: "Yes — $150–$300 range. Valves, lines, switches, and alignment fixes are all standard repairs.",
    relatedSymptoms: ["ice-maker-not-working", "refrigerator-leaking-water", "refrigerator-not-making-ice", "refrigerator-not-cooling"],
    faqs: [
      { q: "Why is my ice maker leaking water into the freezer?", a: "Almost always a stuck fill valve or a misaligned mold. The valve doesn't close, water keeps coming, and the freezer floor gets a sheet of ice." },
      { q: "Should I turn off the ice maker if it's leaking?", a: "Yes. Use the wire arm (push up) or the on/off switch on the maker. Shut the supply valve behind the fridge if you can't stop the flow at the maker itself." },
      { q: "How much does it cost to fix a leaking ice maker?", a: "$150–$300 for valve, line, or alignment fixes. Cracked lines are the cheap end; full valve replacements run higher." },
      { q: "Will a leaking ice maker damage my fridge?", a: "Yes if ignored. Water in the freezer freezes into a sheet of ice that blocks fans and damages the compartment. Water on the floor damages flooring and subflooring." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. The diagnostic fee applies to repair labor. You pay once." }
    ]
  },

  // ===== DISHWASHER =====
  {
    slug: "dishwasher-not-draining",
    appliance: "dishwasher",
    title: "Dishwasher Not Draining",
    h1: "Dishwasher Not Draining",
    metaTitle: "Dishwasher Not Draining? Standing Water at the Bottom | TN Appliance Exchange",
    metaDesc: "Standing water in your dishwasher? It's usually a clogged drain hose, pump, or air gap. We diagnose and quote. Quick Check $50 credited to repair.",
    keywords: "dishwasher not draining, dishwasher standing water, dishwasher drain pump, dishwasher clogged, dishwasher air gap",
    icon: "🍽️",
    quickAnswer: "A dishwasher with standing water almost always has a clogged drain hose, a blocked air gap (or garbage disposal knockout), a clogged sump filter, or a failed drain pump. Most are diagnosable in one visit and most are $150–$300 to fix.",
    causes: [
      { title: "Clogged drain hose", body: "Food debris, grease, and scale collect over years. Hose between the dishwasher and disposal or air gap blocks up." },
      { title: "Missing disposal knockout", body: "When a new garbage disposal is installed, the knockout plug must be removed for the dishwasher drain to flow. If it wasn't, the dishwasher can't drain into the disposal." },
      { title: "Clogged sump filter", body: "The filter at the bottom of the tub collects food bits. When it clogs, water can't reach the pump." },
      { title: "Failed drain pump", body: "Motor or impeller failure. Pump runs but doesn't move water, or doesn't run at all." },
      { title: "Air gap clog", body: "The countertop air gap collects debris. When it's blocked, water can't move past it. Cleaning is usually all it needs." }
    ],
    isItWorthFixing: "Yes — every scenario. Cleaning and unclogs are the cheap end ($150). Drain pump replacement runs $250–$350. No scenario where a draining issue makes a dishwasher not worth fixing.",
    relatedSymptoms: ["dishwasher-not-cleaning", "dishwasher-leaking", "dishwasher-not-starting", "dishwasher-door-latch-broken"],
    faqs: [
      { q: "Why does my dishwasher have standing water?", a: "Drain blockage somewhere in the path — sump filter, drain hose, air gap, or disposal connection — or a failed drain pump. The diagnostic checks all five points." },
      { q: "How do I unclog a dishwasher drain?", a: "Cleaning the sump filter is straightforward and good DIY maintenance. Deeper clogs (hose, air gap, disposal) need access we won't walk through here for liability reasons. We'll handle it in one visit." },
      { q: "Why is my new dishwasher not draining?", a: "Single most common cause on a new install: the garbage disposal knockout plug was never removed. The disposal is brand new and the plug is still in place blocking the dishwasher drain. 5-minute fix once it's identified." },
      { q: "How much does it cost to fix a dishwasher that won't drain?", a: "$150–$300 typical. Cleaning is the cheap end. Drain pump replacement is the upper end." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 or $100 diagnostic applies directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "dishwasher-not-cleaning",
    appliance: "dishwasher",
    title: "Dishwasher Not Cleaning",
    h1: "Dishwasher Not Cleaning Dishes",
    metaTitle: "Dishwasher Not Cleaning? Spots, Residue, Dirty Dishes | TN Appliance Exchange",
    metaDesc: "Dishes coming out dirty? It's usually spray arms, the heat element, or water temperature — not the detergent. Quick Check $50 credited.",
    keywords: "dishwasher not cleaning, dishes dirty after wash, dishwasher spots, dishwasher not washing, spray arm clogged",
    icon: "🍽️",
    quickAnswer: "When a dishwasher stops cleaning well, the cause is usually clogged spray arms, a failed heating element (no hot water during wash), low incoming water temperature, or a worn pump. Detergent and rinse aid matter, but they're not the problem in most cases.",
    causes: [
      { title: "Clogged spray arm jets", body: "Hard water scale and food debris block the small holes. Water sprays unevenly. Cleaning the arms restores coverage." },
      { title: "Failed heating element", body: "Without heat the wash water doesn't reach the temperature needed to cut grease. Dishes come out with film and residue." },
      { title: "Cold incoming water", body: "Dishwashers expect 120°F water. If your water heater is set too low or the supply line is too cold, wash cycles never reach effective temp." },
      { title: "Worn wash pump impeller", body: "Pump still runs but doesn't push enough pressure. Spray arms turn slowly and coverage suffers." },
      { title: "Failed water inlet valve or restricted supply", body: "Not enough water reaches the tub for a proper wash." }
    ],
    isItWorthFixing: "Yes — every cause. Spray arm cleaning is sometimes free at the diagnostic. Heating element $200–$300. Wash pump $300–$400. No scenario where a cleaning issue makes a dishwasher not worth fixing alone.",
    relatedSymptoms: ["dishwasher-not-draining", "dishwasher-leaking", "dishwasher-not-starting", "dishwasher-door-latch-broken"],
    faqs: [
      { q: "Why are my dishes still dirty after the dishwasher?", a: "Most common causes: clogged spray arms, no hot water during wash, weak wash pump, or wrong detergent. The diagnostic checks each one." },
      { q: "What temperature should my water heater be for the dishwasher?", a: "120°F minimum is the industry standard. Below that, modern phosphate-free detergents struggle to dissolve grease. Energy Star confirms 120°F as the right setting." },
      { q: "Will more detergent help if dishes aren't getting clean?", a: "Usually not — and often makes it worse. Too much detergent leaves residue. The real causes are mechanical (spray, heat, pump), not chemical." },
      { q: "How much does it cost to fix a dishwasher that doesn't clean?", a: "$150 for cleaning service. $250–$400 for heating element or pump repairs." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. The diagnostic fee applies to repair labor. One payment." }
    ]
  },
  {
    slug: "dishwasher-leaking",
    appliance: "dishwasher",
    title: "Dishwasher Leaking",
    h1: "Dishwasher Leaking",
    metaTitle: "Dishwasher Leaking? Don't Let It Damage the Floor | TN Appliance Exchange",
    metaDesc: "Dishwasher leaking from the door or underneath? Each location has a specific fix. We diagnose and repair — Quick Check $50 credited.",
    keywords: "dishwasher leaking, dishwasher leaks, dishwasher water on floor, dishwasher door gasket, dishwasher pump leak",
    icon: "🍽️",
    quickAnswer: "Dishwasher leaks come from a short list of suspects: door gasket, drain hose, pump housing, or the tub itself at a seam. The location of the puddle narrows it down fast. Most fixes are $150–$350 — but ignoring a leak leads to floor and cabinet damage in weeks.",
    causes: [
      { title: "Worn door gasket", body: "Rubber dries out and won't seal. Water sprays past the door during wash cycles. Replacement restores the seal." },
      { title: "Loose hose clamp at the pump", body: "Connections vibrate loose over years. Small drip becomes a steady leak. Tightening or replacement fixes it." },
      { title: "Cracked drain or fill hose", body: "Plastic ages and cracks. Hose replacements are routine work." },
      { title: "Worn pump seal", body: "Water leaks out of the pump housing. Pump replacement runs $300–$400." },
      { title: "Tub seam failure", body: "Rare but real. The plastic tub cracks at a stress point. At this point replacement may be the better call." }
    ],
    isItWorthFixing: "Door gasket, hose, and pump — yes every time, $150–$400. Tub failure is the borderline call where replacement often wins.",
    relatedSymptoms: ["dishwasher-not-draining", "dishwasher-not-starting", "dishwasher-door-latch-broken", "dishwasher-not-cleaning"],
    faqs: [
      { q: "Why is my dishwasher leaking from the front door?", a: "Almost always a worn door gasket or a failed door latch letting the door not seat fully. Both are straightforward repairs." },
      { q: "Why is my dishwasher leaking from underneath?", a: "Drain hose, pump housing, or tub seam. The underneath leak gets to the floor faster — get it diagnosed within a day." },
      { q: "Should I keep using a leaking dishwasher?", a: "No. Run-time leaks damage flooring and cabinets. Shut off the supply valve, run a kitchen towel through any standing water, and start a Quick Check." },
      { q: "How much does it cost to fix a leaking dishwasher?", a: "$150 for hose work or simple gasket. $250–$400 for door gasket replacement and pump repairs." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "dishwasher-not-starting",
    appliance: "dishwasher",
    title: "Dishwasher Not Starting",
    h1: "Dishwasher Not Starting",
    metaTitle: "Dishwasher Won't Start? Here's the Quick Diagnostic | TN Appliance Exchange",
    metaDesc: "Dishwasher dead, lights off, or won't begin a cycle? It's usually the door latch, control, or thermal fuse. Quick Check $50 credited.",
    keywords: "dishwasher won't start, dishwasher not starting, dishwasher dead, dishwasher no power, dishwasher won't turn on",
    icon: "🍽️",
    quickAnswer: "A dishwasher that won't start usually has a failed door latch or door switch, a tripped breaker, a blown thermal fuse, or a dead control board. Each is a specific repair at a specific cost — and we rule out the cheap suspects first.",
    causes: [
      { title: "Failed door latch or door switch", body: "Door registers as 'not closed' to the control. Cheap part, most common cause." },
      { title: "Tripped breaker or bad outlet", body: "First check, always. Dishwashers share a circuit with the disposal on many installations." },
      { title: "Blown thermal fuse", body: "One-shot safety that takes the whole control down when it blows. Common on certain Whirlpool and KitchenAid models." },
      { title: "Failed control board", body: "Real but rare. We confirm everything else first." },
      { title: "Failed timer or selector switch", body: "Older mechanical models. Switch contacts wear out." }
    ],
    isItWorthFixing: "Yes — every scenario. Latch and switch repairs $150–$250. Thermal fuse repairs similar. Control board is the higher end but still typically worth it on units under 10 years old.",
    relatedSymptoms: ["dishwasher-door-latch-broken", "dishwasher-not-draining", "dishwasher-not-cleaning", "dishwasher-leaking"],
    faqs: [
      { q: "Why won't my dishwasher start?", a: "Most likely a failed door switch/latch, a tripped breaker, or a blown thermal fuse. Boards are the last suspect, not the first." },
      { q: "Why does my dishwasher have power but won't start a cycle?", a: "Door latch isn't satisfied, or the control board can see power but can't engage the cycle. Sometimes a thermal fuse on the control circuit. Diagnostic narrows it." },
      { q: "How much does it cost to fix a dishwasher that won't start?", a: "$150–$250 for latch and switch repairs. $300+ for control board replacement." },
      { q: "Should I replace a dishwasher that won't start?", a: "Not before someone has confirmed it's not a $40 part. Most won't-start cases are cheap fixes on otherwise working machines." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. One payment." }
    ]
  },
  {
    slug: "dishwasher-door-latch-broken",
    appliance: "dishwasher",
    title: "Dishwasher Door Latch Broken",
    h1: "Dishwasher Door Latch Broken",
    metaTitle: "Dishwasher Door Latch Broken? Quick Fix | TN Appliance Exchange",
    metaDesc: "Door won't latch, latch broken off, or door pops open mid-cycle? Most latch repairs are $150–$250. Quick Check $50 credited.",
    keywords: "dishwasher door latch, dishwasher door won't close, dishwasher door broken, dishwasher latch repair",
    icon: "🍽️",
    quickAnswer: "A broken dishwasher door latch is one of the most common dishwasher repairs and one of the cheapest. The latch assembly bolts in and out in under an hour on most models. Most repairs land $150–$250 including the diagnostic credit.",
    causes: [
      { title: "Broken plastic latch arm", body: "The plastic hook that catches the strike snaps off. Door won't latch at all." },
      { title: "Worn latch spring", body: "Spring loses tension. Door latches but pops open during the cycle." },
      { title: "Misaligned strike plate", body: "The catch on the cabinet has shifted. Adjustment or replacement restores alignment." },
      { title: "Failed door switch within the latch assembly", body: "Latch works mechanically but the switch isn't reporting closed. Cycle won't start." },
      { title: "Broken handle", body: "Front-facing handle that operates the latch fractures. Usually a model-specific part." }
    ],
    isItWorthFixing: "Always — $150–$250 range. There's no scenario where a latch failure makes a dishwasher not worth fixing.",
    relatedSymptoms: ["dishwasher-not-starting", "dishwasher-leaking", "dishwasher-not-cleaning", "dishwasher-not-draining"],
    faqs: [
      { q: "Why won't my dishwasher door latch?", a: "Broken latch arm, worn spring, or misaligned strike. All three are common; all three are fixable in one visit." },
      { q: "Can I keep using a dishwasher with a broken latch?", a: "Most models won't run with the latch open — it's a safety. Don't try to bypass the switch; you'll get a flooded kitchen." },
      { q: "How much does a dishwasher latch repair cost?", a: "$150–$250 typical. Latch assembly is the part; labor is light." },
      { q: "Is my latch broken or is my door alignment off?", a: "If you can hear the latch click but the door pops open, alignment. If there's no click and the latch feels loose, latch. The diagnostic confirms in a minute." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. You pay once." }
    ]
  },

  // ===== OVEN / RANGE / MICROWAVE =====
  {
    slug: "oven-not-heating",
    appliance: "oven",
    title: "Oven Not Heating",
    h1: "Oven Not Heating",
    metaTitle: "Oven Not Heating? Here's What to Check | TN Appliance Exchange",
    metaDesc: "Electric oven not heating? Gas oven not lighting? Each has a specific failure path. We diagnose honestly. Quick Check $50 credited to repair.",
    keywords: "oven not heating, oven won't heat, electric oven not working, oven bake element, oven igniter",
    icon: "🔥",
    quickAnswer: "An electric oven that won't heat is almost always a failed bake element, broiler element, or temperature sensor. A gas oven that won't light is usually a weak igniter or a failed gas safety valve. Each has a specific failure profile and a specific fix.",
    causes: [
      { title: "Failed bake element (electric)", body: "Visible cracks or burn marks on the element. The most common electric oven failure. $200–$300 with diagnostic credit." },
      { title: "Failed broiler element (electric)", body: "Top element doesn't glow. Same diagnostic path as the bake element." },
      { title: "Weak igniter (gas)", body: "Igniter glows but doesn't get hot enough to open the gas safety valve. Igniter replacement is one of the most common gas oven repairs. $250–$350." },
      { title: "Failed temperature sensor", body: "Sensor reads wrong temperature. Oven thinks it's already hot and shuts off the heat. Cheap part, common failure." },
      { title: "Failed control board or relay", body: "Less common but real. Board can't engage the heating circuit." }
    ],
    isItWorthFixing: "Yes — every scenario. Element, igniter, and sensor repairs are all $200–$400. Control board replacements run $400–$600. Wall ovens and built-ins are usually worth fixing because replacement is a major install job.",
    relatedSymptoms: ["oven-not-reaching-temperature", "oven-making-noise", "gas-range-not-lighting", "stove-burner-not-working"],
    faqs: [
      { q: "Why is my oven not heating up?", a: "Failed heating element (electric) or weak igniter (gas) are the most common causes. Temperature sensor failure is the third. Each is a specific test we run during the diagnostic." },
      { q: "Can I keep using my oven if one element is out?", a: "If the broil element is out, the oven can still bake. If the bake element is out, broil only works as a partial replacement. We don't recommend running indefinitely on one element." },
      { q: "How much does it cost to fix an oven?", a: "Heating element repairs $200–$300. Igniter $250–$350. Temperature sensor $150–$250. Control board $400–$600. Diagnostic confirms the part." },
      { q: "Is my oven igniter bad?", a: "If the igniter glows but the burner doesn't light within 60 seconds, the igniter is weak and needs replacement. Common gas oven failure with a clear test." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "oven-not-reaching-temperature",
    appliance: "oven",
    title: "Oven Not Reaching Temperature",
    h1: "Oven Not Reaching Set Temperature",
    metaTitle: "Oven Not Reaching Set Temperature? Calibration or Sensor | TN Appliance Exchange",
    metaDesc: "Oven set to 400 but only reaches 325? It's usually the temperature sensor or calibration. We diagnose and recalibrate. Quick Check $50 credited.",
    keywords: "oven not reaching temperature, oven temperature wrong, oven calibration, oven temperature sensor, oven runs cold",
    icon: "🔥",
    quickAnswer: "An oven that won't reach its set temperature usually has a failing temperature sensor, a calibration drift, a weak heating element on its way out, or a door gasket letting too much heat escape. Each has a different fix and different cost.",
    causes: [
      { title: "Failed temperature sensor", body: "Sensor reads warmer than actual. Control board thinks the oven is at temp and stops heating. Cheap part, common failure." },
      { title: "Calibration drift", body: "Over years, the oven's internal calibration drifts. Some models allow user calibration; others require service. Often the cheapest fix." },
      { title: "Heating element weakening", body: "Element still works but produces less heat than spec. Times go up gradually until it fails completely." },
      { title: "Damaged door gasket", body: "Heat escapes faster than the oven can replace it. Especially visible on long bake cycles." },
      { title: "Failed control board", body: "Less common. Board misreads or misregulates the heating circuit." }
    ],
    isItWorthFixing: "Yes — every cause. Sensor and gasket repairs are $150–$300. Element replacement $200–$350. Recalibration is sometimes free during the diagnostic visit.",
    relatedSymptoms: ["oven-not-heating", "oven-making-noise", "stove-burner-not-working", "gas-range-not-lighting"],
    faqs: [
      { q: "Why is my oven not reaching the temperature I set?", a: "Failed temperature sensor, calibration drift, weakening heating element, or worn door gasket. Diagnostic narrows it." },
      { q: "Can I recalibrate my oven myself?", a: "Some models allow user calibration via the control panel. Others require service tools. The TDR will tell you which path applies to your model." },
      { q: "How accurate should my oven temperature be?", a: "Most ovens are spec'd to within ±25°F of the setpoint. Beyond that, calibration or service is warranted. An oven thermometer placed inside is a good baseline check." },
      { q: "How much does it cost to fix oven temperature problems?", a: "$150–$300 for sensor or gasket. $200–$350 for element. Recalibration sometimes covered in the diagnostic." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "oven-making-noise",
    appliance: "oven",
    title: "Oven Making Noise",
    h1: "Oven Making Noise",
    metaTitle: "Oven Making Noise? Convection Fan, Cooling Fan, Relay | TN Appliance Exchange",
    metaDesc: "Oven humming, rattling, or clicking? Each sound points to a specific part. We diagnose. Quick Check $50 credited to repair.",
    keywords: "oven making noise, oven humming, oven fan noise, oven convection fan, oven cooling fan",
    icon: "🔥",
    quickAnswer: "An oven making noise is usually the convection fan motor, the cooling fan, or a control relay clicking. Each has a different sound and different fix. Most repairs are $200–$400.",
    causes: [
      { title: "Failing convection fan motor", body: "The fan that circulates hot air inside. Bearings dry out and produce a grinding or whining noise. Replacement runs $250–$400." },
      { title: "Failing cooling fan", body: "The fan that vents the control panel area. Different from the convection fan. Usually accessible and a moderate repair." },
      { title: "Clicking relays on the control board", body: "Normal cycling can be audible. Excessive clicking points to a failing relay or thermal cycling issue." },
      { title: "Door hinge or spring noise", body: "Less common but worth checking. Worn door springs can make a creaking sound during preheat." },
      { title: "Element expansion noise", body: "Normal ticking as elements heat. Worth ruling out before chasing fans." }
    ],
    isItWorthFixing: "Yes — fan and relay repairs are $200–$400. No scenario where these make an oven not worth fixing.",
    relatedSymptoms: ["oven-not-heating", "oven-not-reaching-temperature", "stove-burner-not-working", "gas-range-not-lighting"],
    faqs: [
      { q: "Why is my oven making a humming noise?", a: "Usually the cooling fan or convection fan. Bearings wear, motors hum louder as they age. Replacement restores quiet operation." },
      { q: "Is a clicking oven dangerous?", a: "Normal relay clicking during preheat is fine. Constant or excessive clicking points to a failing component — diagnostic confirms." },
      { q: "How much does it cost to fix a noisy oven?", a: "$200–$400 for fan motor replacement. Lower if it's something accessible like a loose panel." },
      { q: "Can I keep using a noisy oven?", a: "Short term yes, but fan failures often cascade — the motor seizes and the oven starts overheating its electronics. Get it diagnosed sooner rather than later." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. You pay once." }
    ]
  },
  {
    slug: "gas-range-not-lighting",
    appliance: "gas range",
    title: "Gas Range Not Lighting",
    h1: "Gas Range Not Lighting",
    metaTitle: "Gas Range Burner Not Lighting? Clicks But No Flame | TN Appliance Exchange",
    metaDesc: "Gas burner clicks but won't light? Or no click at all? It's usually the igniter or burner cap. We diagnose. Quick Check $50 credited.",
    keywords: "gas range not lighting, gas burner won't light, gas range clicks, burner igniter, gas range no spark",
    icon: "🔥",
    quickAnswer: "A gas range burner that clicks but won't light is usually a wet or misaligned burner cap, a clogged burner port, or a weak spark electrode. If there's no click at all, the spark module or its wiring has failed. Most repairs are $150–$300.",
    causes: [
      { title: "Wet or misaligned burner cap", body: "Water from cleaning or spillage interferes with the spark. Or the cap isn't seated properly. Free fix once identified." },
      { title: "Clogged burner port", body: "Food debris blocks the gas channel. Gas can't reach the spark. Cleaning the port restores function." },
      { title: "Failed spark electrode", body: "The igniter pin itself wears out or corrodes. Replacement is a moderate repair." },
      { title: "Spark module failure", body: "The control box that generates the spark voltage. When it fails, no burner clicks. $250–$400 to replace." },
      { title: "Gas supply or safety valve issue", body: "Less common but real — gas isn't reaching the burner. Always check the supply first." }
    ],
    isItWorthFixing: "Yes — every cause. $150–$300 for cleaning and electrode work. $250–$400 for spark module replacement.",
    relatedSymptoms: ["stove-burner-not-working", "oven-not-heating", "oven-not-reaching-temperature", "oven-making-noise"],
    faqs: [
      { q: "Why is my gas burner clicking but not lighting?", a: "Wet or misaligned burner cap, clogged port, or weak electrode. Dry the cap, clean around the burner, and try again. If it still won't light, you've narrowed it to electrode or gas supply." },
      { q: "Can I light my gas burner with a match?", a: "Yes — most gas ranges can be lit with a match if the electric igniter fails. Use long fireplace matches and hold the flame to the burner while turning the knob. If it lights, the electrode is the failure point." },
      { q: "How much does it cost to fix a gas range igniter?", a: "$150–$300 for electrode replacement on a single burner. $250–$400 for full spark module replacement if multiple burners are affected." },
      { q: "Is it safe to use a gas range with a clicking igniter?", a: "Generally yes — but constant clicking is a sign something needs attention. Diagnostic confirms whether the issue is cleanup or a real failure." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "stove-burner-not-working",
    appliance: "stove",
    title: "Stove Burner Not Working",
    h1: "Stove Burner Not Working",
    metaTitle: "Electric Stove Burner Not Working? Switch, Element, Receptacle | TN Appliance Exchange",
    metaDesc: "One electric burner dead while others work? It's usually the element, receptacle, or switch. We diagnose. Quick Check $50 credited.",
    keywords: "stove burner not working, electric burner broken, stove element bad, burner receptacle, stove infinite switch",
    icon: "🔥",
    quickAnswer: "A single electric burner that won't heat is almost always a failed element, a corroded receptacle (where the element plugs in), or a failed infinite switch (the knob's control). Swapping elements between burners is the fastest test — if the cold burner works in another spot, it's the element. If a known-good element doesn't work in the bad spot, it's the receptacle or switch.",
    causes: [
      { title: "Failed heating element", body: "Coil burns through or develops a hot spot. Visible damage usually. Swap test confirms quickly." },
      { title: "Corroded element receptacle", body: "The socket where the element plugs in. Years of heating and cooling corrode the contacts. Replacement restores connection." },
      { title: "Failed infinite switch", body: "The control knob's internal switch. Won't engage the element at all, or engages on only some settings." },
      { title: "Broken element terminal block", body: "On some models the element wires plug into a terminal block. Block corrodes or burns." },
      { title: "Wiring issue at the back of the range", body: "Less common but real on older units. Wire connection at the rear panel degrades." }
    ],
    isItWorthFixing: "Yes — every cause. Element $150–$250. Receptacle $200–$300. Switch $250–$350. No scenario where a single burner failure makes a stove not worth fixing.",
    relatedSymptoms: ["oven-not-heating", "gas-range-not-lighting", "oven-not-reaching-temperature", "oven-making-noise"],
    faqs: [
      { q: "Why is one of my stove burners not working?", a: "Most likely the element itself. Second most likely the receptacle (socket). Third most likely the infinite switch. The swap test isolates which in 60 seconds." },
      { q: "How do I test a stove element?", a: "Swap the suspect element with a known-good element from another burner of the same size. If the bad burner now works, the original element was bad. If it still doesn't work, the issue is downstream (receptacle, switch, wiring)." },
      { q: "How much does it cost to fix one stove burner?", a: "$150–$350 typical, depending on which part. Element only is the cheap end; switch replacement is the upper end." },
      { q: "Can I keep using a stove with one burner out?", a: "Yes — the other burners are unaffected. But get it diagnosed; receptacle issues sometimes cascade if the underlying cause is heat damage." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "microwave-not-heating",
    appliance: "microwave",
    title: "Microwave Not Heating",
    h1: "Microwave Not Heating Food",
    metaTitle: "Microwave Not Heating But Runs? Don't Try to Fix It | TN Appliance Exchange",
    metaDesc: "Microwave runs but doesn't heat? It's usually the magnetron, diode, or capacitor — high voltage parts you should not touch. We diagnose. Quick Check $50.",
    keywords: "microwave not heating, microwave doesn't warm food, microwave magnetron, microwave diode, microwave capacitor",
    icon: "🔥",
    quickAnswer: "A microwave that runs but doesn't heat is almost always a failed magnetron, high-voltage diode, or capacitor. These are high-voltage parts that retain dangerous charge even unplugged — do not attempt DIY repair. The full repair is usually $200–$350, and on units under 5 years old it's worth it. Older units may be the call where replacement makes sense.",
    causes: [
      { title: "Failed magnetron", body: "The tube that generates the microwave energy. Burns out after 5–10 years of heavy use. Most common cause of 'runs but no heat.'" },
      { title: "Failed high-voltage diode", body: "Rectifier that feeds the magnetron. Cheap part but high-voltage handling required." },
      { title: "Failed high-voltage capacitor", body: "Stores the high voltage. Capacitors can retain lethal charge even when unplugged — never touch one without proper discharge tools." },
      { title: "Failed transformer", body: "Less common but the most expensive of the high-voltage failures. Replacement may push toward replacement of the unit itself on lower-end models." },
      { title: "Failed thermal cutoff", body: "Safety device that opens if the magnetron overheats. Cheap part." }
    ],
    isItWorthFixing: "Depends on age and model. Countertop microwaves under $200 usually aren't worth $300+ repairs. Over-the-range and built-in microwaves are almost always worth fixing — replacement is a major install. The TDR shows you the math.",
    relatedSymptoms: ["oven-not-heating", "oven-not-reaching-temperature", "garbage-disposal-not-working", "stove-burner-not-working"],
    faqs: [
      { q: "Why is my microwave running but not heating?", a: "Failed magnetron, diode, or capacitor. All are high-voltage parts and we don't recommend DIY. Diagnostic identifies which is the culprit." },
      { q: "Is a microwave worth repairing?", a: "Depends on type. Cheap countertop units usually not. Over-the-range and built-in units almost always — replacement is a major install. We give you the honest math." },
      { q: "Can I fix a microwave myself?", a: "We don't recommend it. Microwave capacitors can hold lethal voltage even unplugged. Unlike most appliance repairs, this is genuinely dangerous." },
      { q: "How much does it cost to repair a microwave?", a: "$200–$350 for most magnetron/diode jobs. Higher if multiple high-voltage parts fail together." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fee applies to repair labor. One payment." }
    ]
  },
  {
    slug: "garbage-disposal-not-working",
    appliance: "garbage disposal",
    title: "Garbage Disposal Not Working",
    h1: "Garbage Disposal Not Working",
    metaTitle: "Garbage Disposal Humming or Dead? Reset It First | TN Appliance Exchange",
    metaDesc: "Garbage disposal humming, jammed, or completely dead? Try the reset button first. If that's not it, we diagnose and replace. Quick Check $50 credited.",
    keywords: "garbage disposal not working, disposal humming, disposal jammed, disposal won't start, disposal reset button",
    icon: "🔥",
    quickAnswer: "A garbage disposal that hums but doesn't grind has a jammed impeller. A disposal that does nothing has tripped its thermal overload (reset button on the bottom). A completely silent unit with no overload trip is usually a failed motor or switch. Most jams are free fixes; motor replacements run $250–$400 with parts and labor.",
    causes: [
      { title: "Jammed impeller", body: "Most common cause. Bones, fruit pits, or fibrous waste jam the spinning impeller. The motor hums against the stuck mass. Manual unjamming usually works." },
      { title: "Tripped thermal overload", body: "Red reset button on the bottom of the unit. Trips when the motor overheats. Press it after letting the motor cool. Often the first fix to try." },
      { title: "Failed switch", body: "Wall switch or air switch failure. Disposal gets no signal. Tested with a meter." },
      { title: "Failed motor", body: "Bearings or windings give out after years of service. Usually the call where replacement of the whole unit makes more sense than motor repair." },
      { title: "Broken flywheel", body: "Internal mechanical failure. Disposal hums and grinds wrong. Replacement is the standard fix." }
    ],
    isItWorthFixing: "Jams and reset trips — free or very cheap. Switch repairs $150–$250. Motor failure usually points to disposal replacement ($200–$400 installed). Most disposal failures are replacement, not repair.",
    relatedSymptoms: ["dishwasher-not-draining", "dishwasher-leaking", "dishwasher-not-cleaning", "microwave-not-heating"],
    faqs: [
      { q: "Why is my garbage disposal humming but not working?", a: "Jammed impeller. The motor is running but the rotating part is stuck. Don't keep hitting the switch — you'll burn out the motor. Unplug and unjam, or call." },
      { q: "Where is the reset button on my garbage disposal?", a: "Under the unit, in the center. Red button. Press it firmly. If it pops back out, the motor has overheated again — let it cool and try again. If it won't stay in, you've got a deeper failure." },
      { q: "Should I repair or replace a garbage disposal?", a: "Jams and resets are free fixes. Switch replacements yes. But once the motor fails, replacing the unit ($200–$400 installed) usually beats repairing it." },
      { q: "How much does a new garbage disposal cost installed?", a: "$200–$400 for a mid-grade unit installed. Premium models run higher. Disposal replacement is usually faster and more cost-effective than motor repair." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. You pay once." }
    ]
  }
];
