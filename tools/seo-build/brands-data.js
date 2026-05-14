// Brand-page content. One object per URL slug.

module.exports = [
  // ===== WHOLE-LINE BRAND PAGES =====
  {
    slug: "whirlpool-appliance-repair",
    brand: "Whirlpool",
    scope: "all",
    title: "Whirlpool Appliance Repair",
    metaTitle: "Whirlpool Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Whirlpool washer, dryer, refrigerator, dishwasher, or oven not working? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "Whirlpool appliance repair, Whirlpool washer repair, Whirlpool dryer repair, Whirlpool refrigerator repair, Whirlpool dishwasher repair",
    intro: "Whirlpool is one of the most repair-friendly brands on the market. Parts availability is excellent across the entire line, technicians have decades of experience with the platform, and the engineering is well-documented. Whirlpool machines that are 10–15 years old are often very much worth fixing — they were built with serviceable parts and metal cabinets, and they age well.",
    commonIssues: [
      { title: "Direct-drive washer motor coupler failure", body: "Classic Whirlpool top-loader failure. Small plastic coupling between motor and transmission shears. Designed as a sacrificial part — cheap repair on an otherwise excellent machine." },
      { title: "Dryer thermal fuse + airflow issues", body: "Whirlpool dryers trip thermal fuses reliably when airflow is restricted. The dryer is doing its job — the cause is usually a clogged vent line." },
      { title: "Refrigerator defrost system failures", body: "Defrost heater, timer, or thermostat. Causes the classic 'fridge warm, freezer cold' pattern. Known, well-documented repair." },
      { title: "Dishwasher control board moisture damage", body: "Older Whirlpool dishwasher boards are sensitive to humidity. The replacement boards are improved." },
      { title: "Range igniter weakness on gas models", body: "Igniters glow but don't reach temp to open the gas valve. Common at 5–10 year mark. Straightforward replacement." }
    ],
    partsAvailability: "Excellent. Whirlpool parts are widely stocked and aftermarket equivalents are abundant. We rarely run into 'discontinued part' problems on Whirlpool repairs.",
    relatedSymptoms: ["dryer-not-heating", "washer-not-spinning", "refrigerator-not-cooling", "dishwasher-not-draining", "oven-not-heating"],
    faqs: [
      { q: "Is Whirlpool a reliable brand?", a: "Yes — and importantly, very repairable. The platform is well-documented and parts availability is excellent. Even 15-year-old Whirlpool units often have full parts support." },
      { q: "How long do Whirlpool appliances last?", a: "Washers and dryers 12–15 years typical, often longer with maintenance. Refrigerators 13–17 years. Dishwashers 10–13 years. Ranges and ovens 15–20 years. Quality varies by line — heavy-duty models last longer." },
      { q: "Are Whirlpool parts expensive?", a: "Generally no — Whirlpool parts are some of the most affordable in the industry, partly because of strong aftermarket support. Common failure parts like motor couplers, drive belts, and thermal fuses are cheap." },
      { q: "Is it worth repairing an old Whirlpool washer?", a: "Almost always yes. Whirlpool top-loaders from the 90s and 2000s were built with metal transmissions and serviceable parts. A coupler or belt repair often gives another decade." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 Quick Check or $100 in-home diagnostic applies to repair labor. You pay once." }
    ]
  },
  {
    slug: "samsung-appliance-repair",
    brand: "Samsung",
    scope: "all",
    title: "Samsung Appliance Repair",
    metaTitle: "Samsung Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Samsung refrigerator ice maker problems? Washer error codes? Dryer issues? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "Samsung appliance repair, Samsung refrigerator repair, Samsung washer repair, Samsung dryer repair, Samsung ice maker repair",
    intro: "Samsung makes some of the most feature-loaded appliances on the market — and some of the more challenging ones to repair. Refrigerator ice makers in particular are a known weak point. Washer error codes can be cryptic without the right brand-specific knowledge. We've worked on enough Samsung units to know the platform deeply, and we'll give you the honest answer on what's worth fixing.",
    commonIssues: [
      { title: "Refrigerator ice maker failures", body: "Samsung French-door ice makers are well-known to have shorter lifespans than other brands. Replacement modules are available and often the right call." },
      { title: "Washer self-clean drum vibration / drum spider issues", body: "Some Samsung front-loaders develop bearing or spider arm issues. Repair is possible but the labor is significant — sometimes replacement makes more sense." },
      { title: "Dryer error codes / sensor faults", body: "Samsung dryer codes (HE, tE, dE) point to specific failures that are diagnosable but require model-specific knowledge." },
      { title: "Refrigerator compressor on newer linear models", body: "Some Samsung linear compressor models have known compressor issues. Sealed system repairs are expensive — replacement is often the better call." },
      { title: "Dishwasher water inlet / leakage", body: "Common Samsung dishwasher issue with water inlet valve failures." }
    ],
    partsAvailability: "Good for current models. Older Samsung parts can be harder to source than Whirlpool/GE — important consideration for repair-vs-replace decisions on units over 10 years old.",
    relatedSymptoms: ["refrigerator-not-making-ice", "ice-maker-not-working", "washer-not-spinning", "dryer-error-codes", "refrigerator-not-cooling"],
    faqs: [
      { q: "Are Samsung appliances worth repairing?", a: "Depends on the unit and what's broken. Cosmetic and standard wear repairs are absolutely worth it. Sealed system failures on linear compressor models — often where replacement wins. Diagnostic narrows it." },
      { q: "Why do Samsung ice makers fail so often?", a: "The Samsung French-door ice maker design has a known issue with frost buildup and module failures. The newer revisions are improved but older models often need full module replacement. It's a known repair." },
      { q: "How long do Samsung appliances last?", a: "Washers and dryers 8–12 years. Refrigerators 8–12 years (sealed system permitting). Dishwashers 7–10 years. Lifespan generally shorter than Whirlpool/GE but feature set is broader." },
      { q: "Can my Samsung washer be fixed?", a: "Almost always for normal wear (belts, pumps, switches). Spider arm and bearing failures are the gray-area calls where the math shifts. We give you the real numbers." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "lg-appliance-repair",
    brand: "LG",
    scope: "all",
    title: "LG Appliance Repair",
    metaTitle: "LG Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "LG washer error codes? Dryer issues? Refrigerator not cooling? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "LG appliance repair, LG washer repair, LG dryer repair, LG refrigerator repair, LG dishwasher repair",
    intro: "LG appliances are known for innovative features — direct-drive motors, ThinQ connectivity, linear compressors. They can be excellent machines when working, and they have a few well-known failure modes our techs see regularly. Linear compressor refrigerator failures are the biggest cost conversation; everything else is usually a straightforward repair.",
    commonIssues: [
      { title: "Washer LE / locked rotor errors", body: "LG washer direct-drive motors have a known sensor failure mode. The LE code points to it. Diagnostic and repair is well-documented." },
      { title: "Refrigerator linear compressor failures", body: "Some LG linear compressor models have a known failure pattern. Sealed system repair runs $800–$1,500. Replacement often wins on older units. Some models had class action settlements — worth checking." },
      { title: "Dryer flow sense / dE errors", body: "LG dryers report door errors and flow sense errors that are usually inexpensive sensor or switch repairs." },
      { title: "Dishwasher motor / pump", body: "LG dishwasher direct-drive pumps have known failure patterns at the 5–8 year mark." },
      { title: "Top-load washer drum imbalance / suspension", body: "Some LG top-loaders have suspension issues that present as UE codes. Suspension rod replacement is the fix." }
    ],
    partsAvailability: "Good for current models. Some older LG parts are harder to source than American brands. The class-action LG compressor issue does mean parts and warranty coverage may apply on certain models.",
    relatedSymptoms: ["washer-error-codes", "refrigerator-not-cooling", "dryer-error-codes", "washer-not-spinning", "refrigerator-making-noise"],
    faqs: [
      { q: "Are LG appliances worth repairing?", a: "Most LG repairs are absolutely worth it. The honest exception is linear compressor failure on certain refrigerator models — the repair runs $800+ and sometimes the original part has known issues. We check warranty/class-action status as part of the diagnostic." },
      { q: "What is the LG washer LE error?", a: "LE is a locked rotor or motor sensor error. Could be a stuck object, a failed Hall sensor, or a motor failure. The diagnostic narrows it fast — most LE errors are inexpensive repairs." },
      { q: "How long do LG appliances last?", a: "Washers and dryers 10–13 years typical. Refrigerators 8–12 years (compressor permitting). The newer linear compressor models have had reliability issues but the latest generation is improved." },
      { q: "Can my LG refrigerator be fixed?", a: "Most issues yes. Compressor failure on linear models is the gray-area call. Class-action coverage may apply on certain serial number ranges — we check during the diagnostic." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "ge-appliance-repair",
    brand: "GE",
    scope: "all",
    title: "GE Appliance Repair",
    metaTitle: "GE Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "GE refrigerator, washer, dryer, or oven not working? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited toward repair.",
    keywords: "GE appliance repair, GE refrigerator repair, GE washer repair, GE dryer repair, GE Profile repair, GE Cafe repair",
    intro: "GE makes everything from basic builder-grade units to premium Cafe and Profile lines. Repairability is generally good across the line — parts are widely available, the platform is well-documented, and most failures are diagnosable in one visit. The premium Cafe and Profile lines have more electronics, which means more potential failure points but also more sophisticated diagnostic data.",
    commonIssues: [
      { title: "Refrigerator defrost system", body: "Common across many GE refrigerator models. Defrost heater, timer, or thermostat failure causes warm fridge, cold freezer. Known repair." },
      { title: "Profile dual-fuel range igniter failure", body: "Gas igniters weaken at the 5–10 year mark. Standard replacement." },
      { title: "Washer agitator dogs / coupler", body: "Older GE top-loaders had distinctive agitator failures. The agitator clicks but doesn't grab clothes." },
      { title: "Dishwasher control board / heater issue", body: "Some GE dishwasher models have known heater element failures." },
      { title: "Profile microwave magnetron at end of life", body: "5–10 year typical magnetron lifespan. Replacement is straightforward on most over-the-range units." }
    ],
    partsAvailability: "Excellent. GE parts are widely stocked and well-supported. We rarely run into discontinued part issues on GE.",
    relatedSymptoms: ["refrigerator-not-cooling", "dryer-not-heating", "washer-not-spinning", "oven-not-heating", "dishwasher-not-cleaning"],
    faqs: [
      { q: "Are GE appliances reliable?", a: "Yes, generally — and importantly, very repairable. Even 15-year-old GE units typically have full parts support. The platform documentation is excellent." },
      { q: "How long do GE appliances last?", a: "Washers and dryers 12–15 years. Refrigerators 13–17 years. Dishwashers 10–13 years. Ranges 15–20 years. Premium Cafe and Profile lines often last longer with proper maintenance." },
      { q: "Are GE Profile and Cafe worth the premium?", a: "From a repair perspective, they have more electronics but also better build quality on the mechanical side. Parts cost more on Profile/Cafe than basic GE, but lifespan is generally longer." },
      { q: "Is it worth fixing an old GE refrigerator?", a: "Almost always for non-sealed-system failures. The platform parts support is excellent and most repairs are in the $200–$450 range. Sealed system failures (compressor, refrigerant) push toward the replacement conversation." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee applies to repair labor. One payment." }
    ]
  },
  {
    slug: "frigidaire-appliance-repair",
    brand: "Frigidaire",
    scope: "all",
    title: "Frigidaire Appliance Repair",
    metaTitle: "Frigidaire Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Frigidaire washer, dryer, refrigerator, dishwasher, or range not working? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check.",
    keywords: "Frigidaire appliance repair, Frigidaire refrigerator repair, Frigidaire washer repair, Frigidaire dryer repair, Frigidaire range repair",
    intro: "Frigidaire is part of the Electrolux family and shares many platforms. The brand sits in the value-to-mid-tier price range and is generally repair-friendly. Parts availability is good, especially for the more recent models. Older Frigidaire (pre-2010) was excellent and very repairable — newer units are decent but have more electronics that can fail.",
    commonIssues: [
      { title: "Refrigerator evaporator fan failure", body: "Common cause of 'fridge warm, freezer cold' on Frigidaire side-by-sides and French-door models." },
      { title: "Dryer drum bearing / rear support", body: "Frigidaire dryers have a distinctive rear drum support that wears at 5–10 years. Replacement is straightforward." },
      { title: "Front-load washer door switch / lock", body: "Common failure point. Cheap part, common cause of won't-start." },
      { title: "Range temperature sensor", body: "Sensor drift on Frigidaire ranges is a known issue. Replacement restores accuracy." },
      { title: "Dishwasher motor / drain pump", body: "Standard wear at 7–10 year mark." }
    ],
    partsAvailability: "Good. Frigidaire shares platforms with Electrolux so cross-compatible parts are often available. Discontinued issues are rare on current and recent models.",
    relatedSymptoms: ["refrigerator-not-cooling", "dryer-not-heating", "washer-not-spinning", "oven-not-heating", "dishwasher-not-draining"],
    faqs: [
      { q: "Are Frigidaire appliances any good?", a: "They sit in the value-to-mid-tier and are generally fine for normal household use. Repairability is good. Premium Frigidaire Gallery and Professional lines are noticeably better quality." },
      { q: "How long do Frigidaire appliances last?", a: "Washers and dryers 10–13 years. Refrigerators 12–15 years. Dishwashers 8–11 years. Ranges 12–18 years. Lifespan is solid for the price point." },
      { q: "Is it worth repairing a Frigidaire?", a: "Usually yes for non-sealed-system failures. The math gets harder on the cheapest builder-grade models with major control board or compressor failures." },
      { q: "Are Frigidaire parts hard to find?", a: "Generally no. Frigidaire shares the Electrolux platform so parts cross-compatibility is good. Older specialty lines can be harder." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "maytag-appliance-repair",
    brand: "Maytag",
    scope: "all",
    title: "Maytag Appliance Repair",
    metaTitle: "Maytag Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Maytag washer, dryer, refrigerator, dishwasher, or oven not working? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check.",
    keywords: "Maytag appliance repair, Maytag washer repair, Maytag dryer repair, Maytag refrigerator repair, Maytag Neptune repair",
    intro: "Maytag is now part of the Whirlpool family, so most modern Maytag platforms share parts and design with Whirlpool. Older Maytag (pre-2006, when the original company was acquired) was legendarily durable — those machines are absolutely worth fixing when parts are available. Modern Maytag carries the brand reputation forward with solid construction.",
    commonIssues: [
      { title: "Bravos / centennial top-loader transmission", body: "Older Maytag top-loaders had distinctive transmissions. Worth fixing on units in good condition." },
      { title: "Neptune front-loader bearing / pump", body: "Neptune line had known bearing issues at 8–10 year mark. Repair is possible but labor-intensive." },
      { title: "Refrigerator defrost system", body: "Same Whirlpool family defrost platform. Standard repair." },
      { title: "Range igniter / element", body: "Standard heating component failures at 5–10 year mark." },
      { title: "Dishwasher control / drain", body: "Modern Maytag dishwashers share Whirlpool issues — board moisture sensitivity, drain pump wear." }
    ],
    partsAvailability: "Excellent for modern Maytag (Whirlpool-platform). Older pre-2006 Maytag parts are still available for most common failures but less abundant.",
    relatedSymptoms: ["washer-not-spinning", "dryer-not-heating", "refrigerator-not-cooling", "dishwasher-not-cleaning", "oven-not-heating"],
    faqs: [
      { q: "Are Maytag appliances built to last?", a: "Older Maytag (pre-2006) was legendary. Modern Maytag is built on Whirlpool platforms and is solid but no longer set apart from Whirlpool. We see plenty of 15-year-old Maytag washers still going strong." },
      { q: "Is an old Maytag washer worth fixing?", a: "Almost always yes. The classic Maytag dependable line was built to be repaired. Even 20-year-old units often have parts available and the build quality justifies the investment." },
      { q: "How long do Maytag appliances last?", a: "Modern Maytag: 12–15 years typical for washers and dryers, similar to Whirlpool. Older Maytag often lasted 20+ years with maintenance." },
      { q: "Are Maytag parts the same as Whirlpool?", a: "On modern units, yes — they share platforms. On pre-2006 Maytag, parts are specific to the original Maytag design but still widely available for common failures." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee applies to repair labor. One payment." }
    ]
  },
  {
    slug: "bosch-appliance-repair",
    brand: "Bosch",
    scope: "all",
    title: "Bosch Appliance Repair",
    metaTitle: "Bosch Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Bosch dishwasher, washer, dryer, or refrigerator not working? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check.",
    keywords: "Bosch appliance repair, Bosch dishwasher repair, Bosch washer repair, Bosch refrigerator repair, Bosch 800 series",
    intro: "Bosch builds premium-quiet, high-efficiency appliances — especially dishwashers, which are among the best in the world. Repair on Bosch requires more model-specific knowledge than American brands, but the platforms are well-engineered and parts are available. Bosch dishwashers in particular are almost always worth fixing because they outclass the alternatives at the same price point.",
    commonIssues: [
      { title: "Dishwasher heater / heat pump failure", body: "Bosch dishwashers use a heat-pump heat exchanger that's more complex than standard. Failures are diagnosable and repairable, though parts run higher than American brands." },
      { title: "Dishwasher pump / impeller", body: "Standard wear at 7–10 year mark. Quality parts." },
      { title: "Washer / dryer (newer to US market) control issues", body: "Bosch laundry is newer in the US market. Earlier US-market units had some control board issues." },
      { title: "Refrigerator inverter / linear compressor", body: "Bosch high-end refrigerators use inverter compressors. Failures are expensive but rare." },
      { title: "Range oven door / hinge", body: "Bosch oven hinges are notably high-quality but eventually wear at 10+ years." }
    ],
    partsAvailability: "Good. Bosch parts cost more than American brands but availability is solid for current and recent models. Specialty dishwasher parts (water hardness systems, sensor assemblies) require Bosch-specific sourcing.",
    relatedSymptoms: ["dishwasher-not-cleaning", "dishwasher-not-draining", "dishwasher-leaking", "refrigerator-not-cooling", "washer-not-spinning"],
    faqs: [
      { q: "Are Bosch dishwashers worth the money?", a: "Yes — they're among the quietest and most efficient dishwashers made. Repair cost is moderate; longevity is excellent. Almost always worth fixing." },
      { q: "How long do Bosch dishwashers last?", a: "10–15 years typical, often longer with proper care. The build quality is significantly better than entry-level American brands." },
      { q: "Are Bosch parts expensive?", a: "Yes, relative to Whirlpool or GE. But not unreasonably so — and the parts that fail are usually not the expensive ones. Most repairs land $250–$400." },
      { q: "Is it worth fixing an older Bosch dishwasher?", a: "Almost always yes. The build quality justifies the investment and replacement is significantly more expensive at the same quality tier." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. One payment." }
    ]
  },
  {
    slug: "kenmore-appliance-repair",
    brand: "Kenmore",
    scope: "all",
    title: "Kenmore Appliance Repair",
    metaTitle: "Kenmore Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Kenmore washer, dryer, refrigerator, dishwasher, or range not working? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check.",
    keywords: "Kenmore appliance repair, Kenmore washer repair, Kenmore dryer repair, Kenmore refrigerator repair, Sears Kenmore repair",
    intro: "Kenmore is a Sears brand and the appliances are made by various OEMs — typically Whirlpool, LG, Frigidaire, or Samsung depending on year and model. The Kenmore name on the front tells you who sold it; the model number tells you who built it. We identify the OEM during the diagnostic so the right parts and procedures get used.",
    commonIssues: [
      { title: "Direct-drive Kenmore washer (Whirlpool-built) motor coupler", body: "Same Whirlpool platform. Classic coupler failure. Cheap repair." },
      { title: "Kenmore Elite (LG-built) compressor / drum issues", body: "Kenmore Elite models built by LG share LG failure modes. Linear compressor issues apply." },
      { title: "Kenmore dryer thermal fuse / element", body: "Standard dryer failures, typically Whirlpool platform parts." },
      { title: "Kenmore dishwasher control / pump", body: "Varies by OEM. Whirlpool-built Kenmore dishwashers share Whirlpool issues." },
      { title: "Kenmore refrigerator defrost", body: "Standard failure across all OEM platforms." }
    ],
    partsAvailability: "Generally good. Once we identify the OEM (Whirlpool, LG, Frigidaire, or Samsung), parts are sourced through the OEM's standard channels. Some legacy Kenmore-specific parts can be harder to find.",
    relatedSymptoms: ["washer-not-spinning", "dryer-not-heating", "refrigerator-not-cooling", "dishwasher-not-cleaning", "oven-not-heating"],
    faqs: [
      { q: "Who makes Kenmore appliances?", a: "Multiple OEMs — Whirlpool, LG, Frigidaire, Samsung — depending on year and model. The model number (first three digits often) identifies the OEM. We confirm during the diagnostic." },
      { q: "Are Kenmore appliances reliable?", a: "Generally yes, especially older Whirlpool-built Kenmore. Reliability tracks the OEM platform, not the Kenmore badge." },
      { q: "How long do Kenmore appliances last?", a: "Depends on OEM. Whirlpool-built: 12–15 years. LG-built: 10–13 years. Frigidaire-built: 10–13 years. Samsung-built: 8–12 years. The model number tells the story." },
      { q: "Are Kenmore parts hard to find?", a: "Once we identify the OEM, parts are accessible. Specialty Kenmore-branded parts (some control panels) can be harder, but functional equivalents from the OEM are usually available." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. You pay once." }
    ]
  },
  {
    slug: "electrolux-appliance-repair",
    brand: "Electrolux",
    scope: "all",
    title: "Electrolux Appliance Repair",
    metaTitle: "Electrolux Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Electrolux washer, dryer, refrigerator, or range not working? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "Electrolux appliance repair, Electrolux washer repair, Electrolux dryer repair, Electrolux refrigerator repair, Electrolux Icon repair",
    intro: "Electrolux is the parent of Frigidaire and operates as a premium brand with the Electrolux and Electrolux Icon lines. The platforms are well-built, feature-rich, and repairable. Parts cost is mid-to-premium; lifespan is generally longer than entry-level brands. Almost always worth repairing.",
    commonIssues: [
      { title: "Front-load washer motor / control board", body: "Premium Electrolux washers have sophisticated electronics. Control board failures are real but rare." },
      { title: "Refrigerator French-door ice maker", body: "Similar to other premium French-door designs — module failures at 5–10 years are common." },
      { title: "Range dual-fuel control / sensor", body: "Electrolux dual-fuel ranges have multiple sensors. Sensor drift is common." },
      { title: "Dryer steam / sensor issues", body: "Premium feature reliability — steam systems have specific failure modes." },
      { title: "Dishwasher motor / pump / heater", body: "Standard wear at 7–10 year mark." }
    ],
    partsAvailability: "Good. Electrolux parts are mid-priced but well-stocked. Cross-compatibility with Frigidaire is sometimes possible.",
    relatedSymptoms: ["washer-not-spinning", "dryer-not-heating", "refrigerator-not-making-ice", "oven-not-heating", "dishwasher-not-cleaning"],
    faqs: [
      { q: "Are Electrolux appliances worth the money?", a: "Yes for the mid-premium tier. Build quality is noticeably better than entry-level. Repair cost is moderate, lifespan is solid." },
      { q: "How long do Electrolux appliances last?", a: "Washers and dryers 12–15 years. Refrigerators 12–16 years. Dishwashers 10–13 years. Ranges 15–20 years. Solid premium-tier lifespans." },
      { q: "Is an Electrolux washer worth repairing?", a: "Almost always yes for normal wear and tear. The platform is well-engineered and parts are accessible." },
      { q: "Are Electrolux parts more expensive than Frigidaire?", a: "Yes, modestly — Electrolux uses higher-spec components on the same platform family. Worth it for the build quality." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. One payment." }
    ]
  },
  {
    slug: "amana-appliance-repair",
    brand: "Amana",
    scope: "all",
    title: "Amana Appliance Repair",
    metaTitle: "Amana Appliance Repair — Honest Diagnosis & 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Amana washer, dryer, refrigerator, or range not working? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "Amana appliance repair, Amana washer repair, Amana dryer repair, Amana refrigerator repair",
    intro: "Amana is part of the Whirlpool family and shares many platforms with Whirlpool and Maytag. It positions as the value tier of the family — simpler features, basic but reliable construction. Repair-friendly because the platform is well-documented and parts are widely available. Almost always worth fixing.",
    commonIssues: [
      { title: "Top-load washer motor coupler", body: "Shared Whirlpool platform. Classic coupler failure. Cheap repair." },
      { title: "Dryer thermal fuse / element", body: "Whirlpool-family dryer parts. Standard repairs." },
      { title: "Refrigerator defrost system", body: "Shared platform defrost issues. Known repair." },
      { title: "Range igniter / element", body: "Standard Whirlpool-family heating component failures." },
      { title: "Dishwasher motor / drain pump", body: "Shared with entry-level Whirlpool dishwashers." }
    ],
    partsAvailability: "Excellent. Amana shares Whirlpool platform parts so availability is one of the best in the industry.",
    relatedSymptoms: ["washer-not-spinning", "dryer-not-heating", "refrigerator-not-cooling", "oven-not-heating", "dishwasher-not-cleaning"],
    faqs: [
      { q: "Is Amana the same as Whirlpool?", a: "Same family, different brand. Amana is the value tier of the Whirlpool corporation. Parts and platform are largely shared." },
      { q: "How long do Amana appliances last?", a: "10–13 years typical for the value tier. Heavy-duty Amana models last longer. Solid lifespan for the price point." },
      { q: "Are Amana parts easy to find?", a: "Yes — among the easiest in the industry. Whirlpool platform commonality means abundant parts." },
      { q: "Is it worth fixing an Amana washer?", a: "Almost always yes for normal wear. The repair cost is low because parts are inexpensive and the platform is well-documented." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply to repair labor. You pay once." }
    ]
  },

  // ===== APPLIANCE-SPECIFIC BRAND PAGES =====
  {
    slug: "whirlpool-washer-repair",
    brand: "Whirlpool",
    scope: "washer",
    title: "Whirlpool Washer Repair",
    metaTitle: "Whirlpool Washer Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Whirlpool washer not spinning, draining, or starting? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "Whirlpool washer repair, Whirlpool washing machine repair, Whirlpool top loader repair, Whirlpool front loader repair, Whirlpool washer not spinning",
    intro: "Whirlpool washers are some of the most repair-friendly machines on the market. The direct-drive top-loader platform in particular is widely supported, well-documented, and has parts available even on 15+ year-old units. Front-loaders share the Maytag platform and are similarly well-supported. Most Whirlpool washer failures are inexpensive to fix.",
    commonIssues: [
      { title: "Motor coupler failure (direct-drive top-loaders)", body: "The classic Whirlpool failure. Small plastic coupling shears between the motor and transmission. Designed as a sacrificial part. $200–$300 repair." },
      { title: "Drive belt + idler (belt-drive models)", body: "Belts stretch and idlers wear. Common at 7–10 year mark. Standard repair." },
      { title: "Lid switch failure", body: "Cheap part, common cause of won't-spin. Easy diagnostic." },
      { title: "Drain pump failure / clog", body: "Pump impeller fails or gets clogged with a sock. Diagnostic separates them." },
      { title: "Drum bearing (front-load Duet models)", body: "Higher-mile front-loaders develop bearing issues. Major labor but the part itself is straightforward." }
    ],
    partsAvailability: "Excellent. Whirlpool washer parts are among the most accessible in the industry. Aftermarket equivalents are abundant.",
    relatedSymptoms: ["washer-not-spinning", "washer-not-draining", "washer-wont-start", "washer-leaking-water", "washer-error-codes"],
    faqs: [
      { q: "What's the most common Whirlpool washer problem?", a: "On direct-drive top-loaders, the motor coupler. On front-loaders, the drain pump or door lock. Both are inexpensive repairs at well-known failure points." },
      { q: "How long does a Whirlpool washer last?", a: "12–15 years typical, often longer with proper maintenance. Heavy-duty models last 15+ years." },
      { q: "Is it worth fixing an old Whirlpool washer?", a: "Almost always yes. The parts are cheap, the platform is well-documented, and these machines were built to be serviced. A 12-year-old Whirlpool washer with a $250 repair is a better deal than a $700 new machine." },
      { q: "How much does Whirlpool washer repair cost?", a: "Most repairs $200–$350. Motor coupler, pump, lid switch are the common cheap repairs. Drum bearings on front-loaders are the higher end." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your $50 Quick Check or $100 in-home diagnostic applies directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "samsung-washer-repair",
    brand: "Samsung",
    scope: "washer",
    title: "Samsung Washer Repair",
    metaTitle: "Samsung Washer Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Samsung washer error code, not spinning, or won't drain? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check.",
    keywords: "Samsung washer repair, Samsung washing machine repair, Samsung washer error codes, Samsung front load washer, Samsung washer not spinning",
    intro: "Samsung washers are feature-rich and can be excellent machines when working — they also have a distinctive set of common failures that require model-specific knowledge to diagnose. Spider arm and bearing failures on certain front-loaders are the most expensive conversations; everything else is usually a routine repair.",
    commonIssues: [
      { title: "Spider arm corrosion (front-loaders)", body: "Aluminum bracket holding the drum corrodes. Symptoms: severe banging, eventually drum failure. Major repair — often the call where replacement makes sense." },
      { title: "Door lock failures (dE error)", body: "Common Samsung front-load failure. Cheap part, common cause of won't-start." },
      { title: "Drain pump (5E error)", body: "Standard wear or clog. Diagnostic separates them quickly." },
      { title: "Motor / Hall sensor errors", body: "LE-style codes on Samsung washers point to motor or sensor issues. Diagnostic narrows it fast." },
      { title: "Top-load drum bearing", body: "Some Samsung top-loaders develop bearing wear at 5–8 years. Repair is possible but labor-intensive." }
    ],
    partsAvailability: "Good for current and recent models. Older Samsung washer parts (10+ years) can be harder to source.",
    relatedSymptoms: ["washer-not-spinning", "washer-error-codes", "washer-leaking-water", "washer-not-draining", "washer-making-loud-noise"],
    faqs: [
      { q: "What's the most common Samsung washer problem?", a: "On front-loaders: drain pump, door lock, or bearing wear. On top-loaders: motor sensor or drum issues. Each has a clear diagnostic path." },
      { q: "What does dE mean on a Samsung washer?", a: "dE is a door error — the lock isn't reporting closed to the control board. Usually the lock itself; sometimes the wiring. Cheap part, common failure." },
      { q: "Is it worth fixing a Samsung washer?", a: "Yes for most failures (pump, lock, motor sensor — $200–$400 range). The honest gray-area call is spider arm corrosion on front-loaders, where the repair is expensive enough that replacement may make sense." },
      { q: "How long does a Samsung washer last?", a: "8–12 years typical. Feature reliability is good when components are working; lifespan is shorter than Whirlpool/GE." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "lg-washer-repair",
    brand: "LG",
    scope: "washer",
    title: "LG Washer Repair",
    metaTitle: "LG Washer Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "LG washer LE code, UE error, or won't spin? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "LG washer repair, LG washing machine repair, LG washer LE code, LG washer UE error, LG washer not spinning, LG direct drive",
    intro: "LG washers feature direct-drive motors that eliminate the belt and reduce wear points. When working, they're efficient and reliable. The most common LG washer failures are sensor and pump issues. The famous LE error is a motor or Hall sensor fault that ranges from very cheap (object stuck in drum) to mid-range (sensor replacement).",
    commonIssues: [
      { title: "LE error (motor / Hall sensor)", body: "Most common LG washer fault. Sometimes a stuck object; sometimes a failed sensor; rarely the motor itself. Diagnostic separates them quickly." },
      { title: "UE error (imbalance)", body: "If repeated on normal loads, points to suspension rod wear. Replacement restores balance." },
      { title: "Drain pump failure", body: "Standard wear at 7–10 year mark." },
      { title: "Door lock / dE error", body: "Cheap part, common cause of won't-start." },
      { title: "Suspension rods (top-loaders)", body: "Top-load LG models develop suspension issues that present as imbalance and noise." }
    ],
    partsAvailability: "Good for current models. Some older LG parts can be harder than American brands.",
    relatedSymptoms: ["washer-not-spinning", "washer-error-codes", "washer-not-draining", "washer-making-loud-noise", "washer-wont-start"],
    faqs: [
      { q: "What's the most common LG washer error?", a: "LE (locked rotor / Hall sensor) and UE (unbalanced load) are the two most common error codes. LE points to motor/sensor; UE to suspension or loading." },
      { q: "How do I fix LE error on my LG washer?", a: "Sometimes a reset clears it (unplug 5 min). If it returns, you have a real failure — usually a sensor, sometimes a stuck object in the drum, rarely the motor. Diagnostic confirms." },
      { q: "Is it worth fixing an LG washer?", a: "Most LG washer repairs are absolutely worth it. Sensor and pump repairs run $200–$350. Drum bearing or motor failures are the higher-end conversations." },
      { q: "How long does an LG washer last?", a: "10–13 years typical. Direct-drive design reduces some wear points; sensor reliability is the dominant failure category." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "whirlpool-dryer-repair",
    brand: "Whirlpool",
    scope: "dryer",
    title: "Whirlpool Dryer Repair",
    metaTitle: "Whirlpool Dryer Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Whirlpool dryer not heating, taking too long, or making noise? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "Whirlpool dryer repair, Whirlpool gas dryer repair, Whirlpool electric dryer repair, Whirlpool dryer not heating, Whirlpool dryer belt",
    intro: "Whirlpool dryers are among the most serviceable on the market. The platform is shared across Whirlpool, Maytag, Amana, KitchenAid, and many Kenmore models. Parts are abundant and inexpensive. Almost every Whirlpool dryer failure is worth fixing — the cost of repair is a fraction of replacement on these machines.",
    commonIssues: [
      { title: "Thermal fuse + airflow", body: "Most common no-heat failure. Fuse blows due to restricted airflow. Fix the fuse, fix the vent — or it'll blow again." },
      { title: "Heating element (electric) / igniter (gas)", body: "Standard failures at 8–12 year mark. Inexpensive parts, straightforward replacement." },
      { title: "Drive belt + idler + rollers", body: "Common refresh job. All three replaced together once the dryer is apart — minimal additional labor." },
      { title: "Door switch / start switch", body: "Cheap parts, common won't-start causes." },
      { title: "Blower wheel / motor", body: "Less common but real. Failure at 10+ years." }
    ],
    partsAvailability: "Excellent. Whirlpool dryer parts are among the most affordable and accessible in the industry.",
    relatedSymptoms: ["dryer-not-heating", "dryer-not-spinning", "dryer-making-noise", "dryer-takes-too-long", "dryer-wont-start"],
    faqs: [
      { q: "Why is my Whirlpool dryer not heating?", a: "On Whirlpool dryers, no-heat is almost always a blown thermal fuse, a failed heating element (electric), or a weak igniter (gas). The thermal fuse blows because of airflow restriction — fix the vent at the same time." },
      { q: "How long does a Whirlpool dryer last?", a: "12–18 years typical. Heavy-duty models last longer. We see plenty of 20-year-old Whirlpool dryers still going strong after periodic repairs." },
      { q: "Is it worth fixing a Whirlpool dryer?", a: "Almost always yes. Most repairs are $150–$300 and the machine has years left. Replacement only makes sense when multiple major systems are failing at once on a 15+ year unit." },
      { q: "How much does Whirlpool dryer repair cost?", a: "Most repairs $150–$300. Thermal fuse is the cheap end. Element, igniter, and belt/idler/roller combos are mid-range. Motor or blower replacements are the higher end." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Your diagnostic fee applies to repair labor. One payment." }
    ]
  },
  {
    slug: "samsung-dryer-repair",
    brand: "Samsung",
    scope: "dryer",
    title: "Samsung Dryer Repair",
    metaTitle: "Samsung Dryer Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Samsung dryer error code, not heating, or won't start? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "Samsung dryer repair, Samsung dryer error codes, Samsung dryer not heating, Samsung dryer HE code, Samsung dryer tE code",
    intro: "Samsung dryers feature sensor-driven moisture detection and advanced electronics. The platform is reliable for routine wear, with most repairs in the $200–$350 range. Heating system failures and sensor faults are the most common conversations.",
    commonIssues: [
      { title: "Heating element / thermal fuse (HE code)", body: "Standard no-heat failure path. HE error points to heating circuit. Diagnostic narrows to fuse, element, or sensor." },
      { title: "Moisture sensor (tE code)", body: "Temperature or moisture sensor drift. Cheap part, common cause of incorrect dry times." },
      { title: "Drum belt / idler", body: "Standard wear at 7–10 year mark." },
      { title: "Door switch / drum bearing", body: "Common Samsung dryer wear points." },
      { title: "Control board (less common)", body: "Boards are the last suspect — diagnosis confirms the cheaper parts are fine first." }
    ],
    partsAvailability: "Good for current and recent models. Older Samsung dryer parts can require sourcing time.",
    relatedSymptoms: ["dryer-not-heating", "dryer-error-codes", "dryer-takes-too-long", "dryer-wont-start", "dryer-making-noise"],
    faqs: [
      { q: "What does HE mean on my Samsung dryer?", a: "HE is a heating error — the dryer isn't reaching expected temperature, or the heating circuit isn't engaging. Usually a thermal fuse, element, or sensor. Diagnostic separates them." },
      { q: "How long do Samsung dryers last?", a: "8–12 years typical. Build quality is solid for normal use. Sensor reliability is the dominant failure category." },
      { q: "Is it worth fixing a Samsung dryer?", a: "Yes for most failures (sensor, fuse, element, belt). Control board replacement on older units is the gray-area conversation." },
      { q: "Why does my Samsung dryer keep stopping?", a: "Usually a moisture sensor reading wrong, a thermistor reporting overheat, or an airflow restriction triggering protection. Each has a clear diagnostic path." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "lg-dryer-repair",
    brand: "LG",
    scope: "dryer",
    title: "LG Dryer Repair",
    metaTitle: "LG Dryer Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "LG dryer error code, not heating, or won't start? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "LG dryer repair, LG dryer error codes, LG dryer not heating, LG dryer dE code, LG dryer flow sense",
    intro: "LG dryers are feature-rich with sensor-driven moisture detection and connected diagnostics. Most failures are sensor, fuse, or element-level repairs in the $200–$350 range. The flow sense feature catches airflow issues early — a useful early warning.",
    commonIssues: [
      { title: "Heating element / thermal cutoff", body: "Standard no-heat path. Element burns through or thermal cutoff opens." },
      { title: "Flow sense errors", body: "LG dryers monitor airflow. Restricted vents trigger flow sense codes early — useful diagnostic clue." },
      { title: "Door switch / dE error", body: "Cheap part, common cause of won't-start." },
      { title: "Belt / idler", body: "Standard wear." },
      { title: "Sensor bar (moisture sensor)", body: "Two metal strips inside the drum. Cleaning sometimes helps; replacement is straightforward." }
    ],
    partsAvailability: "Good for current models.",
    relatedSymptoms: ["dryer-not-heating", "dryer-error-codes", "dryer-takes-too-long", "dryer-wont-start", "dryer-making-noise"],
    faqs: [
      { q: "What does dE mean on my LG dryer?", a: "dE is a door error — the door switch isn't reporting closed. Cheap part, common failure." },
      { q: "How long do LG dryers last?", a: "10–13 years typical. Sensor and electronics reliability is generally good." },
      { q: "Is it worth fixing an LG dryer?", a: "Yes for most failures (sensor, fuse, element, belt — all $200–$350)." },
      { q: "Why is my LG dryer showing 'flow sense'?", a: "Flow sense is LG's airflow restriction detection. Get the vent cleaned and the warning usually clears. Cheap to fix; expensive to ignore (causes element and fuse failures)." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "samsung-refrigerator-repair",
    brand: "Samsung",
    scope: "refrigerator",
    title: "Samsung Refrigerator Repair",
    metaTitle: "Samsung Refrigerator Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Samsung fridge ice maker, not cooling, or making noise? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "Samsung refrigerator repair, Samsung fridge ice maker, Samsung French door refrigerator, Samsung refrigerator not cooling",
    intro: "Samsung refrigerators are feature-rich and stylish. The French-door platform is the dominant Samsung design and it has one well-known weakness: ice makers. Frost buildup and module failures are the most common Samsung fridge complaints. Cooling system issues are real but less common, and sealed-system failures on newer linear-compressor models are the most expensive conversations.",
    commonIssues: [
      { title: "Ice maker frost / module failure", body: "The signature Samsung French-door issue. Newer revisions improve it but older units often need full module replacement. Known repair." },
      { title: "Defrost heater / sensor", body: "Causes 'fridge warm, freezer cold' pattern. Standard cooling-system repair." },
      { title: "Evaporator fan", body: "Common cause of poor cooling and ice maker frosting." },
      { title: "Linear compressor (certain models)", body: "Some Samsung linear compressor refrigerators have known reliability issues. Sealed system repair is the most expensive call." },
      { title: "Water filter / water valve issues", body: "Standard wear." }
    ],
    partsAvailability: "Good for current models. Samsung ice maker modules are readily available — usually in stock.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-not-making-ice", "ice-maker-not-working", "refrigerator-leaking-water", "refrigerator-making-noise"],
    faqs: [
      { q: "Why does my Samsung ice maker keep failing?", a: "The original Samsung French-door ice maker design accumulates frost and the module fails. Newer revisions are improved. Module replacement is the standard fix and well within the typical repair cost range." },
      { q: "How long do Samsung refrigerators last?", a: "8–12 years typical. Sealed system permitting; some compressor issues on certain models shorten this." },
      { q: "Is it worth fixing a Samsung refrigerator?", a: "Most non-sealed-system repairs yes ($200–$450). Compressor failure on linear-compressor models is the gray-area call where replacement may make more sense." },
      { q: "How much does Samsung ice maker repair cost?", a: "Most module replacements run $300–$450 with parts and labor. The diagnostic confirms whether the whole module is needed or a sub-component fix works." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "lg-refrigerator-repair",
    brand: "LG",
    scope: "refrigerator",
    title: "LG Refrigerator Repair",
    metaTitle: "LG Refrigerator Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "LG refrigerator not cooling, linear compressor issue, or ice maker problem? Our techs build a Technician Decision Report. $50 Quick Check credited.",
    keywords: "LG refrigerator repair, LG fridge linear compressor, LG French door refrigerator, LG refrigerator not cooling",
    intro: "LG refrigerators are stylish, feature-rich, and use linear inverter compressors that promise efficiency and longevity. Some early linear compressor models had reliability issues that resulted in a class action settlement — worth checking warranty status on units 2017–2022. Outside of compressor failure, most LG refrigerator repairs are routine.",
    commonIssues: [
      { title: "Linear compressor failure (certain serial ranges)", body: "Some LG linear compressors fail prematurely. Class action settlement covers specific serial number ranges. We check during the diagnostic." },
      { title: "Ice maker module / water valve", body: "Standard French-door ice maker issues." },
      { title: "Defrost system", body: "Standard 'fridge warm, freezer cold' repairs." },
      { title: "Evaporator fan", body: "Common cooling and noise repair." },
      { title: "Door alarm / sensor issues", body: "LG models with smart features can develop sensor faults." }
    ],
    partsAvailability: "Good. LG compressor warranty coverage may apply on specific models — we check during the diagnostic.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-not-making-ice", "refrigerator-making-noise", "ice-maker-not-working", "refrigerator-leaking-water"],
    faqs: [
      { q: "Is my LG refrigerator covered under the class action?", a: "Possibly. Specific serial number ranges of LG linear compressor refrigerators (2014–2017 manufacture, certain models) are covered. We check serial during the diagnostic." },
      { q: "How long do LG refrigerators last?", a: "8–12 years typical. Linear compressor reliability is the dominant question. The latest generation is improved over earlier versions." },
      { q: "Is it worth fixing an LG refrigerator?", a: "Most non-sealed-system repairs yes. Linear compressor failure on a 5+ year unit is the gray-area conversation where replacement often wins." },
      { q: "What is the LG linear compressor problem?", a: "Some early LG linear compressors had a manufacturing issue causing premature failure. Affected units lose cooling entirely. LG covered the parts under a class settlement; labor is separately negotiable. We check status during the diagnostic." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "whirlpool-refrigerator-repair",
    brand: "Whirlpool",
    scope: "refrigerator",
    title: "Whirlpool Refrigerator Repair",
    metaTitle: "Whirlpool Refrigerator Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "Whirlpool refrigerator not cooling, ice maker problem, or leaking water? Our techs build a Technician Decision Report. $50 Quick Check credited.",
    keywords: "Whirlpool refrigerator repair, Whirlpool fridge not cooling, Whirlpool ice maker, Whirlpool French door refrigerator",
    intro: "Whirlpool refrigerators are some of the most repair-friendly on the market. The platform is shared across Whirlpool, KitchenAid, Maytag, Amana, and many Kenmore models. Parts availability is excellent, the platform is well-documented, and most failures are inexpensive to fix. Almost always worth repairing on units up to 15+ years old.",
    commonIssues: [
      { title: "Defrost system (heater, timer, thermostat)", body: "Most common Whirlpool fridge failure. Causes warm fridge, cold freezer. $250–$400 standard repair." },
      { title: "Evaporator / condenser fan", body: "Common cooling and noise failure." },
      { title: "Ice maker module", body: "Standard module replacement at 7–10 year mark." },
      { title: "Water inlet valve / water line", body: "Common cause of ice maker and dispenser failures." },
      { title: "Compressor start relay", body: "Cheap part, common cause of clicking on/off." }
    ],
    partsAvailability: "Excellent. Whirlpool refrigerator parts are widely available and affordable.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-not-making-ice", "refrigerator-leaking-water", "refrigerator-making-noise", "refrigerator-door-seal-broken"],
    faqs: [
      { q: "Why is my Whirlpool refrigerator not cooling?", a: "Most likely the defrost system, an evaporator fan, or a stuck damper. The classic 'fridge warm, freezer cold' pattern points to defrost or airflow — both are $250–$450 repairs." },
      { q: "How long do Whirlpool refrigerators last?", a: "13–17 years typical, often longer with maintenance. Heavy-duty side-by-side and French-door models last well." },
      { q: "Is it worth fixing a Whirlpool refrigerator?", a: "Almost always yes for non-sealed-system failures. The parts are accessible, the platform is well-documented, and these machines age well." },
      { q: "How much does Whirlpool refrigerator repair cost?", a: "Most repairs $200–$450. Defrost system, fan, ice maker, and valve repairs are the common range. Sealed system failures push higher." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  },
  {
    slug: "ge-refrigerator-repair",
    brand: "GE",
    scope: "refrigerator",
    title: "GE Refrigerator Repair",
    metaTitle: "GE Refrigerator Repair — Honest 4-Option TDR | TN Appliance Exchange",
    metaDesc: "GE refrigerator, GE Profile, or GE Cafe not cooling? Our techs build a Technician Decision Report with 4 honest options. $50 Quick Check credited.",
    keywords: "GE refrigerator repair, GE Profile refrigerator, GE Cafe refrigerator, GE fridge not cooling, GE refrigerator ice maker",
    intro: "GE refrigerators run from basic builder-grade to premium GE Profile and Cafe lines. Repairability is excellent across the line — parts availability is among the best in the industry. Most GE refrigerator failures are routine, well-documented repairs.",
    commonIssues: [
      { title: "Defrost system failures", body: "Common across GE refrigerator models. Standard repair." },
      { title: "Evaporator fan", body: "Common cooling failure." },
      { title: "GE Cafe / Profile Keurig / advanced features", body: "Premium GE features have specific failure modes — diagnostic is model-specific." },
      { title: "Ice maker / water filter system", body: "Standard ice maker wear at 7–10 year mark." },
      { title: "Compressor (sealed system)", body: "Less common but real. The most expensive call." }
    ],
    partsAvailability: "Excellent. GE refrigerator parts are widely available.",
    relatedSymptoms: ["refrigerator-not-cooling", "refrigerator-not-making-ice", "refrigerator-leaking-water", "refrigerator-making-noise", "refrigerator-freezing-food"],
    faqs: [
      { q: "Why is my GE refrigerator not cooling?", a: "Most likely defrost system, evaporator fan, or condenser coils. Each has a clear diagnostic path and $250–$450 repair range." },
      { q: "How long do GE refrigerators last?", a: "13–17 years for standard GE. GE Profile and Cafe often last longer with the higher-spec build quality." },
      { q: "Is it worth fixing a GE Profile refrigerator?", a: "Almost always yes. The build quality justifies the investment and replacement of a Profile or Cafe unit is significantly more expensive at the same quality tier." },
      { q: "How much does GE refrigerator repair cost?", a: "Standard GE: $200–$450 for common repairs. Profile/Cafe: 15–30% higher on parts but similar diagnostic approach." },
      { q: "Do I have to pay the diagnostic fee AND the repair cost?", a: "No. Diagnostic fees apply directly to repair labor. You pay once." }
    ]
  }
];
