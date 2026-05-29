// Template catalog for the Colony Architect.
//
// Each template detects whether it applies to a given blueprint agent
// (by looking at outputs / triggers / purpose) and renders a JS file string
// + the canonical filename + the signal_type the generated agent listens on.
//
// Templates rely on Claude to produce the *domain-specific* system prompt
// for each generated agent. The surrounding scaffolding (imports, run()
// signature, signal emit, log + markSignalProcessed) is identical across
// agents in the same family.
//
// Today the catalog supports:
//   diagnostic_specialist          — DIAGNOSTIC_BRIEF emitter
//   brand_specialist               — BRAND_INTELLIGENCE emitter
//   research_specialist            — RESEARCH_DATA emitter
//   sms_responder                  — CUSTOMER_SMS_REPLY emitter
//   parts_intelligence             — PARTS_INTELLIGENCE emitter
//   scheduling_optimizer           — SCHEDULING_DECISION emitter
//   performance_coach              — PERFORMANCE_INSIGHT emitter
//   recruiting_specialist          — RECRUITING_INSIGHT emitter
//   hvac_specialist                — HVAC_INTELLIGENCE emitter
//   mentorship_specialist          — MENTORSHIP_INSIGHT emitter
//   warranty_claims                — WARRANTY_CLAIM_ACTION emitter
//   service_agreement_specialist   — SERVICE_AGREEMENT_INSIGHT emitter
//   customer_intelligence          — CUSTOMER_INTELLIGENCE emitter
//   voice_prompt_optimizer         — VOICE_PROMPT_PROPOSAL emitter
//   market_intelligence            — MARKET_INTELLIGENCE emitter
//   infrastructure_monitor         — INFRASTRUCTURE_INSIGHT emitter
//   tech_lifecycle                 — TECH_LIFECYCLE_INSIGHT emitter
//   meta_agent                     — META_AGENT_INSIGHT emitter (agents that
//                                    evaluate/clone/refactor other agents)
//
// Dispatch convention: dispatch.js routes one handler per signal_type, so
// each generated agent gets its own per-domain signal_type. A future
// "router" agent (or job_created.js fan-out) is expected to emit the
// per-domain signal in response to JOB_CREATED / DIAGNOSTIC_BRIEF; until
// that wiring lands the generated agents sit dormant but ready.
//
// To add a new template, write another render*() function + a detector
// branch in generateAgent().

// ── Detectors ────────────────────────────────────────────────────

function isDiagnosticSpecialist(agent) {
  const outputs = (agent.outputs || []).join(' ');
  return /DIAGNOSTIC_BRIEF/i.test(outputs);
}

function isBrandSpecialist(agent) {
  const outputs = (agent.outputs || []).join(' ');
  return /BRAND_INTELLIGENCE/i.test(outputs);
}

function isResearchAgent(agent) {
  const outputs = (agent.outputs || []).join(' ');
  // Broadened 2026-05-26: catch R005 (MODEL_INTELLIGENCE) and R006
  // (HISTORICAL_INTELLIGENCE) which share the research-agent scaffolding
  // (query source → simulated intel) but emit different output types.
  return /RESEARCH_DATA|MODEL_INTELLIGENCE|HISTORICAL_INTELLIGENCE/i.test(outputs);
}

function isSmsResponder(agent) {
  // SMS-responder agents emit CUSTOMER_SMS_REPLY, are tagged with an
  // SMS purpose, or have an SMS_RESPONSE_<TYPE> trigger.
  const outputs = (agent.outputs || []).join(' ');
  if (/CUSTOMER_SMS_REPLY|SMS_REPLY|SMS_RESPONSE/i.test(outputs)) return true;

  const triggers = (agent.triggers || []).join(' ');
  if (/SMS_RESPONSE_/i.test(triggers)) return true;

  const purpose = String(agent.purpose || agent.description || '').toLowerCase();
  const name = String(agent.name || '').toLowerCase();
  const combined = purpose + ' ' + name;
  return /\bcustomer\b.*\bsms\b|\bsms\b.*\breply\b|\bsms\b.*\bresponse\b|sms\s+responder|customer.*reply.*agent/.test(combined);
}

function smsTypeFromAgent(agent) {
  // Prefer explicit slug from triggers ("type=parts_arrival").
  const trig = (agent.triggers || []).join(' ');
  const m1 = trig.match(/SMS_RESPONSE_([A-Z0-9_]+)/);
  if (m1) return m1[1].toLowerCase();
  const m2 = trig.match(/type\s*=\s*([a-z0-9_]+)/i);
  if (m2) return m2[1].toLowerCase();
  // Fallback: derive from name. "Parts Arrival SMS Responder" → parts_arrival.
  const name = String(agent.name || '')
    .replace(/\s*SMS\s*Responder$/i, '')
    .replace(/\s*Customer\s*Reply\s*Agent$/i, '')
    .replace(/\s*Reply\s*Agent$/i, '')
    .trim();
  if (!name) return null;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function smsTypeDisplayFromAgent(agent, slug) {
  const name = String(agent.name || '')
    .replace(/\s*SMS\s*Responder$/i, '')
    .replace(/\s*Customer\s*Reply\s*Agent$/i, '')
    .replace(/\s*Reply\s*Agent$/i, '')
    .trim();
  if (name) return name;
  return slug.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function isPartsIntelligence(agent) {
  const outputs = (agent.outputs || []).join(' ');
  if (/PARTS_INTELLIGENCE/i.test(outputs)) return true;

  const purpose = String(agent.purpose || agent.description || '').toLowerCase();
  const name = String(agent.name || '').toLowerCase();
  const combined = purpose + ' ' + name;
  // Word-boundary matches to avoid false positives (e.g. "departments").
  return /\bparts?\b|\boem\b|\bmarcone\b|\bsupplier|\b(order|reorder|backorder)\b|\b(part[\- ]?number|sku)\b/.test(combined);
}

function partsDomainFromAgent(agent) {
  const trig = (agent.triggers || []).join(' ');
  const m = trig.match(/PARTS_LOOKUP_([A-Z0-9_]+)/);
  if (m) return m[1].toLowerCase();
  const m2 = trig.match(/(?:domain|category)\s*=\s*([a-z0-9_]+)/i);
  if (m2) return m2[1].toLowerCase();
  // Derive from name — strip common suffixes.
  const name = String(agent.name || '')
    .replace(/\s*(Parts|Agent|Intelligence|Specialist|Responder)$/gi, '')
    .replace(/\s*(Parts|Agent|Intelligence|Specialist|Responder)\b/gi, '')
    .trim();
  if (!name) return null;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function partsDomainDisplay(agent, slug) {
  const name = String(agent.name || '')
    .replace(/\s*(Parts|Agent|Intelligence|Specialist)\s*Agent?$/gi, '')
    .trim();
  if (name) return name;
  return slug.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function isSchedulingOptimizer(agent) {
  const outputs = (agent.outputs || []).join(' ');
  if (/SCHEDULING_DECISION|SCHEDULE_DECISION/i.test(outputs)) return true;

  const purpose = String(agent.purpose || agent.description || '').toLowerCase();
  const name = String(agent.name || '').toLowerCase();
  const combined = purpose + ' ' + name;
  // Broadened 2026-05-26: cover S001-S020 second-wave scheduling agents
  // (flexibility intake, urgency scoring, anchor placement, cluster
  // geometry, gap calculation, real-time gap watching, same-day
  // opportunity, job duration learning, etc).
  return /\bschedul\w*|\brout(e|ing)\b|\bcapacit\w*|\bavailabilit\w*|\bdispatch|\bslot|\bcalendar|\bgap[\- ]?fill|\bflexibilit\w*|\burgency\b|\banchor\b|\bcluster\s+geometry\b|\bgap\s+(calculator|watcher|optimizer)\b|\bduration\s+(learning|model)\b|\bre[\- ]?engagement\b|\bsame[\- ]?day\s+opportunity\b/.test(combined);
}

function schedulingScopeFromAgent(agent) {
  const trig = (agent.triggers || []).join(' ');
  const m = trig.match(/SCHEDULE_REQUEST_([A-Z0-9_]+)/);
  if (m) return m[1].toLowerCase();
  const m2 = trig.match(/(?:scope|type)\s*=\s*([a-z0-9_]+)/i);
  if (m2) return m2[1].toLowerCase();
  const name = String(agent.name || '')
    .replace(/\s*(Scheduling|Schedule|Optimizer|Agent)$/gi, '')
    .trim();
  if (!name) return null;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function schedulingScopeDisplay(agent, slug) {
  const name = String(agent.name || '')
    .replace(/\s*(Scheduling|Schedule|Optimizer)\s*Agent?$/gi, '')
    .trim();
  if (name) return name;
  return slug.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── COLONY BUILD MODE: 10 high-leverage templates (added 2026-05-26) ──
//
// Each follows the same shape: detector function, slug extractor, and a
// shared renderGenericSpecialist() call from the dispatch branch below.
// Slugs default to agent id when no naming pattern fits.

function _slugFromName(name, suffixRegex) {
  let n = String(name || '').trim();
  if (suffixRegex) n = n.replace(suffixRegex, '').trim();
  if (!n) return null;
  return n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function _displayFromName(name, slug, suffixRegex) {
  let n = String(name || '').trim();
  if (suffixRegex) n = n.replace(suffixRegex, '').trim();
  if (n) return n;
  return slug.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// 1. recruiting_specialist
function isRecruitingSpecialist(agent) {
  const id = String(agent.id || '');
  if (/^REC\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\brecruit|\bhiring\b|\bcandidate\b|\bapplicant\b|\bindeed\b|\blinkedin\b|\bfacebook\s+ad|\btiktok\b|\breferral\b|\bdraft\s+(announcement|hype|story|amplification)\b/.test(c);
}

// 2. hvac_specialist
function isHvacSpecialist(agent) {
  const id = String(agent.id || '');
  if (/^H\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bhvac\b|\brefrigerant\b|\bepa\s*608\b|\bcarrier\b|\blennox\b|\btrane\b|\bcommissioning\b|\binstall\s+opportunity/.test(c);
}

// 3. mentorship_specialist
function isMentorshipSpecialist(agent) {
  const id = String(agent.id || '');
  if (/^ME\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bmentor\b|\bmentee\b|\bmentorship\b|\bmentor\s+tree\b|\bequity\s+calculator\b/.test(c);
}

// 4. warranty_claims
function isWarrantyClaims(agent) {
  const id = String(agent.id || '');
  if (/^W\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bclaim\b|\bahs\s+claim|\bfrontdoor\b|\bauthorization\s+request|\bdenial\s+pattern|\bresubmission|\bpayment\s+reconciliation|\bwarranty\s+portal/.test(c);
}

// 5. service_agreement_specialist
function isServiceAgreementSpecialist(agent) {
  const id = String(agent.id || '');
  if (/^SA\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bservice\s+agreement|\bmaintenance\s+(reminder|plan)|\bequipment\s+age|\bagreement\s+renewal|\bupsell\s+intelligence|\bpost[-\s]?job\s+education/.test(c);
}

// 6. customer_intelligence
function isCustomerIntelligence(agent) {
  const id = String(agent.id || '');
  if (/^CI\d/i.test(id)) return true;
  // CA### = Customer Acquisition colony — same template family
  if (/^CA\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bcustomer\s+lifetime\s+value\b|\bappliance\s+age\s+profile\b|\bproactive\s+outreach\b|\bcustomer\s+satisfaction\s+scor\w*|\bsubdivision\s+detector\b|\breferral\s+program\b|\bcold\s+outreach\b|\bservice\s+zone\s+expansion\b|\bretention\s+cohort\b|\bdemand\s+heatmap\b|\bacquisition\s+cost\b/.test(c);
}

// 6b. business_intelligence (financial tracking colony)
function isBusinessIntelligence(agent) {
  const id = String(agent.id || '');
  if (/^BI\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\brevenue\b|\bar\s+aging\b|\bcash\s+position\b|\bmargin\s+per\s+job\b|\breimbursement\s+lag\b|\btax\s+liability\b|\btech\s+earnings\b|\bfleet\s+cost\b|\bcustomer\s+acquisition\s+cost\b|\bprofitability\s+by\s+zone\b/.test(c);
}

// 7. voice_prompt_optimizer
function isVoicePromptOptimizer(agent) {
  const id = String(agent.id || '');
  if (/^V\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bvapi\b|\bvoice\s+transcript|\btranscript\s+analyz|\bprompt\s+(improvement|proposal)|\bvoice\s+(agent|prompt)/.test(c);
}

// 8. market_intelligence
function isMarketIntelligence(agent) {
  const id = String(agent.id || '');
  // M### IDs go to market_intelligence (Marketing colony) — NOT meta_agent.
  // The meta_agent detector was originally given M### too, which mis-routed
  // every Marketing colony agent. Marketing wins because its ID prefix is
  // semantically marketing, not meta.
  if (/^BI\d/i.test(id)) return true;
  if (/^M\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bcompetitor\s+gap|\bmanufacturer\s+relationship\b|\bmarket\s+expansion\b|\bseasonal\s+demand\b|\bcompetit(or|ive)\s+intel|\bmarket\s+scout\b|\bgmb\b|\bseo\b|\byelp\b|\bnextdoor\b|\bbacklink\b|\blocal\s+pack\b|\bbrand\s+mention\b|\bprofile\s+watcher\b|\bkeyword\s+tracker\b|\breview\s+watcher\b/.test(c);
}

// 9. infrastructure_monitor
function isInfrastructureMonitor(agent) {
  const id = String(agent.id || '');
  if (/^INFRA\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bsignal\s+router\b|\bcolony\s+health\b|\breinforcement\s+learning\b|\bcolony\s+architect\b|\binfrastructure\s+monitor\b/.test(c);
}

// 11. meta_agent — agents that evaluate, score, or generate other agents.
//      Keyword-only match (the previous M### shortcut collided with the
//      Marketing colony's M### IDs and misrouted them all to meta_agent).
function isMetaAgent(agent) {
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bfitness\s+scorer\b|\bagent\s+cloner\b|\bmeta\s+agent\b|\bagent\s+evaluator\b|\bagent\s+(fitness|quality|performance)\b|\bclone[rs]?\b\s+agent/.test(c);
}

// 10. tech_lifecycle
function isTechLifecycle(agent) {
  const id = String(agent.id || '');
  if (/^TC\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\btech\s+confidence\b|\bnew\s+tech\b|\bonboarding\b|\bcertification\s+tracker\b|\bfirst\s+90\s+days\b|\bfirst\s+visit\s+fix\s+rate\b|\btdr\s+tutor\b/.test(c);
}

// 12. content_generator — Andre Personal Brand + Story and Why colonies.
//      Content writing for blog/social/email use cases.
function isContentGenerator(agent) {
  const id = String(agent.id || '');
  if (/^AB\d/i.test(id)) return true;
  if (/^SW\d/i.test(id)) return true;
  const c = (agent.purpose + ' ' + agent.name).toLowerCase();
  return /\bcontent\s+generator\b|\bstory\s+writer\b|\bblog\b|\bsocial\s+post\b|\btestimonial\s+curator\b|\bmanifesto\b|\bnarrative\b/.test(c);
}

// ── End of COLONY BUILD MODE template detectors ──

function isPerformanceCoach(agent) {
  const outputs = (agent.outputs || []).join(' ');
  if (/PERFORMANCE_INSIGHT|COACHING_RECOMMENDATION|PERFORMANCE_COACHING/i.test(outputs)) return true;

  // PC### id-prefix shortcut (Tech Performance and Coaching colony)
  const id = String(agent.id || '');
  if (/^PC\d/i.test(id)) return true;

  const purpose = String(agent.purpose || agent.description || '').toLowerCase();
  const name = String(agent.name || '').toLowerCase();
  const combined = purpose + ' ' + name;
  return (
    /\btech\s+performance\b|\bperformance\s+coach|\bcoach(ing)?\b|\bmetric\w*\s+coach|\btdr\s+quality|\bquality\s+of\s+(work|tdr|repair)|\bdaily\s+reflection\b|\breflection\s+prompt/.test(combined)
    || (/\bperformance\b/.test(combined) && /\b(tech|technician|metrics|coach|tdr)\b/.test(combined))
  );
}

function performanceScopeFromAgent(agent) {
  const trig = (agent.triggers || []).join(' ');
  const m = trig.match(/PERFORMANCE_REQUEST_([A-Z0-9_]+)/);
  if (m) return m[1].toLowerCase();
  const m2 = trig.match(/(?:scope|focus)\s*=\s*([a-z0-9_]+)/i);
  if (m2) return m2[1].toLowerCase();
  const name = String(agent.name || '')
    .replace(/\s*(Performance|Coach|Coaching|Agent)$/gi, '')
    .trim();
  if (!name) return null;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function performanceScopeDisplay(agent, slug) {
  const name = String(agent.name || '')
    .replace(/\s*(Performance|Coach|Coaching)\s*Agent?$/gi, '')
    .trim();
  if (name) return name;
  return slug.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function applianceFromTriggers(agent) {
  // Form 1: "JOB_CREATED with appliance_type=washer" (original D001-D005 form)
  const text = (agent.triggers || []).join(' ');
  const m = text.match(/appliance_type\s*=\s*([a-z_]+)/i);
  if (m) return m[1].toLowerCase();
  // Form 2: bare DIAGNOSE_<APPLIANCE> signal (H015 DIAGNOSE_HVAC_HEAT_PUMP,
  // H016 DIAGNOSE_HVAC_FURNACE, future DIAGNOSE_HVAC_AC, etc). The slug
  // after DIAGNOSE_ is the appliance — works for compound terms.
  const m2 = text.match(/\bDIAGNOSE_([A-Z][A-Z0-9_]+)\b/);
  if (m2) return m2[1].toLowerCase();
  return null;
}

// Humanize an appliance slug for the diagnostic prompt:
//   washer → "washer"
//   hvac_heat_pump → "HVAC heat pump"
//   refrigerator → "refrigerator"
function humanizeAppliance(slug) {
  if (!slug) return slug;
  return slug
    .split('_')
    .map((w) => (w === 'hvac' || w === 'ac' || w === 'epa' ? w.toUpperCase() : w))
    .join(' ');
}

function brandFromAgent(agent) {
  // Prefer explicit slug from triggers ("brand=whirlpool_family").
  const trig = (agent.triggers || []).join(' ');
  const m = trig.match(/brand\s*=\s*([a-z0-9_]+)/i);
  if (m) return m[1].toLowerCase();
  // Fallback: derive from name ("Whirlpool Family Brand Agent" → whirlpool_family).
  const name = String(agent.name || '').replace(/\s*Brand\s*Agent$/i, '').trim();
  if (!name) return null;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function brandDisplayFromAgent(agent, slug) {
  const name = String(agent.name || '').replace(/\s*Brand\s*Agent$/i, '').trim();
  if (name) return name;
  return slug.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function sourceFromAgent(agent) {
  // Derive from name. "iFixit Research Agent" → ifixit; "Service Matters
  // Research Agent" → service_matters; "MarconeAI Research Agent" → marconeai.
  const name = String(agent.name || '').replace(/\s*Research\s*Agent$/i, '').trim();
  if (!name) return null;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function sourceDisplayFromAgent(agent, slug) {
  const name = String(agent.name || '').replace(/\s*Research\s*Agent$/i, '').trim();
  if (name) return name;
  return slug.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Meta-prompts ──────────────────────────────────────────────────

function metaPromptForDiagnostic(applianceSlug) {
  const appliance = humanizeAppliance(applianceSlug);
  const isHvac = /\bhvac\b/i.test(appliance);
  const brandList = isHvac
    ? 'Carrier, Trane, Lennox, Goodman, Rheem, York, American Standard, Bryant, Mitsubishi, Daikin'
    : 'Whirlpool, GE, LG, Samsung, Maytag, Frigidaire, KitchenAid';
  return (
    `You are designing the Claude system prompt for a "${appliance} diagnostic specialist" agent. ` +
    `This agent receives one job: brand, model number, and customer-reported problem text. ` +
    `It must produce the top 3 likely failure modes ranked by probability. For each failure mode include:\n` +
    `  - one-sentence "confirm with:" evidence the tech should look for to verify\n` +
    `  - common OEM part number(s) when known\n` +
    `  - typical labor time in minutes\n\n` +
    `Write the system prompt now. Be specific to ${appliance} units across major brands (${brandList}). ` +
    `Use plain-English failure descriptions a journeyman tech would recognize. Format the agent's output as a numbered list. ` +
    `Output ONLY the system prompt text — no preamble, no commentary, no explanation of what you're doing.`
  );
}

function metaPromptForBrand(brandDisplay) {
  return (
    `You are designing the Claude system prompt for a "${brandDisplay}" appliance brand specialist agent. ` +
    `This agent receives appliance type, model number, and symptom (a short customer complaint). ` +
    `It must return brand-specific intelligence: known failure patterns for ${brandDisplay} on the specific platform indicated by the model number, ` +
    `notable service bulletins or recall-class issues, common bad-batch model ranges if applicable, ` +
    `and OEM part recommendations specific to ${brandDisplay}.\n\n` +
    `Format the output as four sections with these exact headers:\n` +
    `1. PLATFORM IDENTIFICATION: which ${brandDisplay} platform the model belongs to (e.g., VMW, ThinQ, VRT) and what that tells you.\n` +
    `2. KNOWN FAILURE PATTERNS: top 3 issues this platform is known for, ranked by frequency.\n` +
    `3. SERVICE BULLETINS / RECALLS: any documented service notices relevant to this model range.\n` +
    `4. PARTS NOTES: ${brandDisplay}-specific part-number conventions, cross-references, supersession warnings.\n\n` +
    `Be specific. If you do not know a fact, write "Not on file" rather than guessing. ` +
    `Output ONLY the system prompt text — no preamble, no commentary, no meta-text.`
  );
}

function metaPromptForParts(domainDisplay) {
  return (
    `You are designing the Claude system prompt for a "${domainDisplay}" appliance parts intelligence agent. ` +
    `This agent specializes in identifying, sourcing, pricing, and validating compatibility of replacement parts for ` +
    `home appliances (washers, dryers, dishwashers, refrigerators, ranges, ovens, microwaves).\n\n` +
    `The agent receives: appliance type, brand, model number, the failed component or part description, ` +
    `optionally a tech-supplied verified_part_number, and customer-reported symptom. It must return structured ` +
    `parts intelligence in this exact shape:\n\n` +
    `1. PART IDENTIFICATION: the most likely OEM part number(s) for this failure, with confidence (high/medium/low). ` +
    `Include the manufacturer's canonical number AND any common supersession references.\n` +
    `2. SOURCING: top 2-3 suppliers ranked by typical availability for ${domainDisplay}-relevant parts ` +
    `(Marcone, Reliable Parts, AppliancePartsPros, RepairClinic, encompass, manufacturer-direct). ` +
    `Mention any known stock issues or extended ETAs.\n` +
    `3. PRICING: typical retail price range and any common warranty-discount paths.\n` +
    `4. COMPATIBILITY NOTES: cross-model fitment, supersession history, and any known wrong-part traps (similar ` +
    `numbers that fit but cause issues).\n` +
    `5. INSTALL FLAGS: special tools needed, refrigerant handling, or proprietary fittings that change labor estimate.\n\n` +
    `Be specific. If a fact is unknown, write "Not on file" rather than guessing. Never invent part numbers — ` +
    `if you cannot identify the OEM number with reasonable confidence, say so and recommend a tech-side lookup.\n\n` +
    `Output ONLY the system prompt text — no preamble, no commentary, no meta-text.`
  );
}

function metaPromptForScheduling(scopeDisplay) {
  return (
    `You are designing the Claude system prompt for a "${scopeDisplay}" tech scheduling and routing optimizer agent. ` +
    `This agent optimizes the placement of new appliance-repair jobs onto a fleet of techs working a daily route, ` +
    `balancing geographic clustering, tech capacity, customer time-window constraints, and revenue-per-route.\n\n` +
    `The agent receives a structured payload: the new job (job_id, customer location, appliance type, problem ` +
    `summary, customer_preference_text such as "weekday mornings only", warranty_company, urgency), available ` +
    `techs with their current day's job list and remaining capacity, and any constraints (sick-day cascades, ` +
    `parts-arrival ETAs, prior assignments). It must return a structured scheduling decision in this exact shape:\n\n` +
    `1. RECOMMENDED ASSIGNMENT: top tech + time-slot pick, with explicit reasoning ` +
    `(distance from prior stop, tech specialty match, customer constraint satisfaction).\n` +
    `2. ALTERNATIVES: 2 backup tech+slot pairs ranked by score, with what's worse about each.\n` +
    `3. CAPACITY FLAGS: any techs running over 6 jobs already, or with route-distance > 60 miles for the day, ` +
    `or sick-day risks for the target date.\n` +
    `4. CUSTOMER FIT: how well the recommended slot matches customer_preference_text. If poor match, ` +
    `flag a "propose 3 options" path rather than direct-book.\n` +
    `5. REVENUE NOTE: whether this assignment helps fill a gap that would otherwise leave a tech idle, ` +
    `or whether it stacks onto an already-full route.\n\n` +
    `Be specific to ${scopeDisplay}-style optimization. Never assign work to techs not in the supplied tech list. ` +
    `Never invent capacity numbers. If a key field is missing (e.g. customer zip), say so and recommend the ` +
    `default "broadcast" fallback.\n\n` +
    `Output ONLY the system prompt text — no preamble, no commentary, no meta-text.`
  );
}

function metaPromptForPerformance(scopeDisplay) {
  return (
    `You are designing the Claude system prompt for a "${scopeDisplay}" tech performance and coaching agent. ` +
    `This agent analyzes a technician's recent work to surface coaching opportunities, quality issues, and ` +
    `performance trends. It runs against TN Appliance Exchange's TDR (technician decision report) data, job ` +
    `completion records, and time-on-site signals.\n\n` +
    `The agent receives a structured payload for one tech: tech_id, first_name, last 30-90 days of TDRs ` +
    `(diagnosis text, failure_cause, repair_completed flag, labor_time_hours, customer_facing_diagnosis), ` +
    `job completion outcomes (completed / awaiting_parts / no_fix_possible / held), recall/callback rate, and ` +
    `customer feedback signals (1-5 ratings, free-text comments). It must return structured performance ` +
    `intelligence in this exact shape:\n\n` +
    `1. SUMMARY: one-line snapshot of this tech's recent trajectory (improving / steady / regressing) with ` +
    `the single most important metric driving that label.\n` +
    `2. STRENGTHS: top 2 things this tech is doing well, with specific examples from the data.\n` +
    `3. GAPS: top 2 ${scopeDisplay} coaching opportunities, with specific evidence and what "better" looks like.\n` +
    `4. TDR QUALITY: assessment of recent TDR completeness — are failed_component, labor_time_hours, ` +
    `repair_completed, customer_facing_diagnosis being filled in fully? Flag the worst-offender field.\n` +
    `5. NEXT STEP: one concrete coaching action Teddy could send via SMS this week (under 200 chars).\n\n` +
    `Be respectful and direct — these techs are field professionals, not students. Never call out a single ` +
    `customer complaint as proof; require a pattern of 3+ instances before flagging. Never compare techs to ` +
    `each other in the output. If the data is too thin for a confident assessment, say "Not enough data" ` +
    `rather than speculating.\n\n` +
    `Output ONLY the system prompt text — no preamble, no commentary, no meta-text.`
  );
}

// ── COLONY BUILD MODE meta-prompts ──

function metaPromptForRecruiting(roleDisplay) {
  return `You are designing the Claude system prompt for a "${roleDisplay}" recruiting agent for TN Appliance Exchange's tech-recruiting platform (ANT). This agent specializes in one slice of the recruiting funnel for appliance-repair techs.\n\nThe agent receives: channel context (Indeed/Facebook/TikTok/LinkedIn/referral), candidate signal (job posting performance, applicant data, market signals), and recent action history. It must return structured recruiting intelligence in this exact shape:\n1. SITUATION: one-line snapshot of current state in this channel/role.\n2. RECOMMENDATIONS: top 3 concrete actions (post X, adjust Y, message Z), ranked by expected hire impact.\n3. METRIC TO WATCH: the leading indicator that confirms whether action 1 is working.\n4. ESCALATIONS: anything Teddy needs to decide personally (budget changes, market exits, brand voice).\n\nBe specific to appliance-repair recruiting (not generic SaaS hiring). Never fabricate competitor data. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForHvac(domainDisplay) {
  return `You are designing the Claude system prompt for an "${domainDisplay}" HVAC specialist agent. This agent operates inside TN Appliance Exchange's HVAC division (currently 1 dedicated HVAC tech, Jordan; expanding).\n\nThe agent receives: equipment context (brand, model, serial, age, refrigerant type), customer symptom, recent service history, and any applicable compliance constraints (EPA 608, local permits).\n\nIt must return structured HVAC intelligence in this exact shape:\n1. DIAGNOSIS or RECOMMENDATION: domain-specific finding (top failure mode, install opportunity, compliance flag, etc.).\n2. SAFETY / COMPLIANCE FLAGS: refrigerant phase-out, EPA reporting requirements, permit requirements, lockout-tagout concerns.\n3. PARTS / SOURCING: HVAC-specific OEM channels (manufacturer-direct, Johnstone, Baker, Carrier Enterprise) with typical ETAs.\n4. NEXT-VISIT CHECKLIST: 3-5 items the tech should verify or document on this job.\n\nBe specific to ${domainDisplay}. Never invent refrigerant compatibility or EPA rules — if uncertain, write "Tech must verify on-site". Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForMentorship(domainDisplay) {
  return `You are designing the Claude system prompt for a "${domainDisplay}" mentorship specialist agent. This agent runs the mentor-tree economy of TN Appliance Exchange's tech roster — pairing, tracking, recognizing, advancing, and (when necessary) demoting mentors based on mentee outcomes.\n\nThe agent receives: mentor record (id, tier, current mentees, equity earned), mentee records (recent performance, milestones hit, time-since-onboard), historical pairing data, and any flag events (engagement drops, quality regressions, milestone hits).\n\nIt must return structured mentorship intelligence in this exact shape:\n1. STATUS: one-line snapshot of mentor/mentee relationship health.\n2. ACTION: concrete next step (recognize, pair, advance, demote, intervene), with reasoning.\n3. EQUITY IMPACT: how this affects mentor's earnings/tier and what the system should write to mentor_equity table.\n4. COMMUNICATION: the SMS / message the mentor or mentee should receive, written in their voice (200 chars max).\n\nBe specific to ${domainDisplay}. Never call out a mentor publicly for poor performance — frame coaching as private and private only. Never demote on a single bad data point; require ≥60 days of pattern. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForWarrantyClaims(vendorDisplay) {
  return `You are designing the Claude system prompt for a "${vendorDisplay}" warranty-claims agent for TN Appliance Exchange. This agent handles warranty claim lifecycle automation for one warranty platform (AHS, SquareTrade, ServicePower, Frontdoor, Cinch, etc.).\n\nThe agent receives: completed job context (job_id, completion_type, TDR with failed_component / labor_time_hours / verified_part_number / repair_completed / customer_facing_diagnosis), warranty company portal requirements, prior claim outcomes for this vendor (approved/denied patterns), and the specific lifecycle action being requested (submit / authorize / status-check / resubmit / reconcile-payment).\n\nIt must return structured warranty-claim output in this exact shape:\n1. CLAIM PAYLOAD: the exact fields and values to submit to ${vendorDisplay}'s portal, formatted as the vendor expects (JSON if API, key-value list if web form).\n2. LANGUAGE OPTIMIZATION: any phrasing tweaks that historically improve approval rates for this vendor.\n3. DOCUMENTATION FLAGS: which TDR fields are incomplete and would risk denial — Danielle/Teddy should fill these before submission.\n4. EXPECTED OUTCOME: typical approval probability + ETA based on vendor history.\n5. ESCALATION: when human intervention is required (denial appeal, multi-step authorization, payment dispute) — the marker is "__ESCALATE_DANIELLE__".\n\nBe specific to ${vendorDisplay}'s known requirements. Never invent claim numbers or pre-authorization codes. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForServiceAgreement(typeDisplay) {
  return `You are designing the Claude system prompt for a "${typeDisplay}" service-agreement and customer-retention agent. This agent runs TN Appliance Exchange's annual-maintenance-plan / proactive-outreach loop — identifying customers ready for an agreement, sending right-moment communications, and managing renewals.\n\nThe agent receives: customer record (history, appliance inventory, age of each unit, recent service interactions, current agreement status if any), seasonal context, and any trigger (e.g. equipment crossed age threshold, service call completed 3 days ago, agreement expiring in 30 days).\n\nIt must return structured service-agreement output in this exact shape:\n1. CUSTOMER FIT: high/medium/low based on appliance inventory + history; reasoning.\n2. RECOMMENDED OFFER: which agreement tier, what's included, target price.\n3. OUTREACH MESSAGE: the SMS or email the customer should receive — conversational, naturally helpful, never pushy (300 chars max).\n4. TIMING: when to send (now / wait N days / next seasonal window) with reasoning.\n5. UPSELL OPPORTUNITY: identify the single highest-value related service to mention next time, without overloading this touch.\n\nBe specific to ${typeDisplay}. Never invent pricing. Never make the message feel like a hard sale. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForCustomerIntelligence(scopeDisplay) {
  return `You are designing the Claude system prompt for a "${scopeDisplay}" customer-intelligence agent for TN Appliance Exchange. This agent builds and maintains the customer-centric data layer — lifetime value, appliance-age profile, satisfaction signals, proactive outreach triggers.\n\nThe agent receives: customer record + full job history + appliance inventory (model, age, last service, parts replaced) + recent feedback signals (ratings, free-text comments, reschedule/cancel rate). It must return structured customer intelligence in this exact shape:\n1. CLV TIER: high/medium/low/at-risk + reasoning, including the 12-month forward-look estimate.\n2. INVENTORY MAP: each appliance the customer owns, its estimated remaining life, and the next likely failure category.\n3. OUTREACH TRIGGERS: future moments (date + reason) the system should reach out proactively — capped at 3 to avoid spam.\n4. SATISFACTION SIGNAL: any patterns in feedback that flag a churn risk or a referral opportunity.\n5. NEXT-BEST-ACTION: the single most valuable thing the system could do for/about this customer this month.\n\nBe specific to ${scopeDisplay}. Never invent appliance ages — if model has no age data, mark "unknown". Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForBusinessIntelligence(scopeDisplay) {
  return `You are designing the Claude system prompt for a "${scopeDisplay}" business-intelligence agent for TN Appliance Exchange. This agent watches the financial heartbeat of the company — revenue, receivables, cash, margin, tax, reimbursements, fleet, acquisition cost, zone profitability — and surfaces actionable signals.\n\nThe agent receives: relevant data slice (e.g. for a Daily Revenue Tracker — yesterday's completed jobs, parts margin rows, prior 7-day baseline; for an AR Aging Reporter — outstanding warranty + self-pay invoices with age buckets; for a Cash Position Watcher — Stripe + bank balances with upcoming payout obligations).\n\nIt must return structured BI output in this exact shape:\n1. HEADLINE: a 1-line owner-facing number ("Yesterday: $4,820. 7-day avg: $4,100 (+18%)" or "AR > 60d: $12,400 across 8 jobs").\n2. CONTEXT: what changed vs the prior comparable period + the most likely driver (1-2 sentences max).\n3. ALERTS: any threshold breaches (low cash before payroll, large past-due, margin below 30%, tax-due window).\n4. RECOMMENDED ACTIONS: ordered list of moves Teddy can make this week to act on the signal.\n5. CONFIDENCE: how much of the signal is rock-solid (data we own) vs estimated (e.g. tax projection).\n\nBe specific to ${scopeDisplay}. Never invent dollar figures — if data is missing, flag it. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForVoicePrompt(scopeDisplay) {
  return `You are designing the Claude system prompt for a "${scopeDisplay}" voice/SMS prompt optimization agent. This agent improves the system prompts powering TN Appliance Exchange's Vapi voice agents and SMS conversational agents, based on real transcripts.\n\nThe agent receives: a transcript (or batch), the specific Vapi/SMS agent it came from, the agent's current system prompt, the outcome (successful intent capture / dropped / escalated / customer frustrated), and any tagged "failure points" from prior analysis.\n\nIt must return structured prompt-optimization output in this exact shape:\n1. FAILURE PATTERN: the single most important thing the current prompt is doing wrong, with 1-2 verbatim transcript excerpts as evidence.\n2. PROPOSED EDIT: the specific text addition/change to the system prompt, formatted as a diff (- old, + new) or a clear "add this section: ...".\n3. EXPECTED IMPROVEMENT: what behavior should change after the edit, with the measurable signal to confirm it (e.g. "drop rate at intent X falls below Y").\n4. RISKS: what could regress if this edit is applied.\n5. APPROVAL REQUEST: human-readable summary for Teddy to approve before the edit is pushed to the live agent (300 chars max).\n\nBe specific to ${scopeDisplay}. Never propose edits without transcript-level evidence. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForMarketIntelligence(scopeDisplay) {
  return `You are designing the Claude system prompt for a "${scopeDisplay}" market-intelligence agent for TN Appliance Exchange. This agent watches the broader market — competitors, manufacturers, geography, demand patterns — and surfaces strategic signals.\n\nThe agent receives: market signal payload (competitor listing, review feed, demand data, manufacturer pricing change, etc.), historical context for the metric/region, and current company position (active zip codes, tech count per region).\n\nIt must return structured market intelligence in this exact shape:\n1. SIGNAL: what changed in the market that matters.\n2. SO WHAT: how it affects TN Appliance Exchange in the next 30/90/365 days.\n3. ACTION RECOMMENDATION: top 1-2 moves to consider (enter market, exit, adjust pricing, deepen manufacturer relationship, etc.) with confidence.\n4. EVIDENCE: the specific data points / URLs / quotes that support the signal.\n5. WATCH LIST: which adjacent signals would confirm or refute this within 30 days.\n\nBe specific to ${scopeDisplay}. Never present a guess as a confirmed pattern — confidence labels are mandatory. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForInfrastructure(scopeDisplay) {
  return `You are designing the Claude system prompt for an "${scopeDisplay}" infrastructure agent for TN Appliance Exchange's Mac Mini colony loop. This is platform-internal — the agent does NOT face customers or techs. It watches the loop's own health, routes signals, or feeds reinforcement learning from outcomes.\n\nThe agent receives: telemetry payload (signal volumes, processing latencies, error rates, agent-by-agent throughput, recent event_log activity, queue depths). It must return structured infrastructure output in this exact shape:\n1. HEALTH SNAPSHOT: green/yellow/red + the single most important metric driving the label.\n2. DETECTED ISSUES: each issue with severity, scope, and the specific signal/agent/table involved.\n3. RECOMMENDED ACTIONS: ordered list of remediations the loop or operator can take now.\n4. ESCALATIONS: when human (Teddy) intervention is required — the marker is "__ESCALATE_OPERATOR__".\n5. TREND OUTLOOK: where the system is heading on the current trajectory (next 24 hours).\n\nBe specific to ${scopeDisplay}. Never invent metric numbers. If telemetry is missing, say so and recommend the source to add. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForContentGenerator(scopeDisplay) {
  return `You are a content-generation specialist for "${scopeDisplay}" within the Ant platform for TN Appliance Exchange (an appliance repair company in Middle TN + Southeast LA).\n\nThe agent receives a content brief payload: {topic, persona, tone, length_words, context}. It writes the actual content — blog post, social post, email copy, testimonial summary, recap, manifesto, story.\n\nIt must return strict structured JSON in this exact shape:\n{\n  "content_text": "The full piece in markdown. Match length_words ± 20%. Match the requested persona voice precisely.",\n  "title": "A short title (under 70 chars) suitable for SEO + social",\n  "preview": "1-sentence summary for social previews",\n  "tags": ["...", "...", "..."],\n  "cta": "The single call-to-action embedded near the end"\n}\n\nRULES for the writing itself:\n- Be SPECIFIC. Use real appliance brands (Whirlpool / GE / LG / Samsung / Frigidaire / KitchenAid / Bosch), real Middle TN cities (Antioch, Nashville, Franklin, Brentwood, Clarksville), real Southeast LA cities (Hammond, Walker, Baton Rouge, Covington).\n- Avoid AI-tells: don't open with "In today's fast-paced world", don't use "tapestry" / "delve" / "moreover" / "embarking on a journey", don't end with "In conclusion".\n- Write like Teddy talks: direct, friendly, technical when needed, never corporate fluff. Short sentences. Real anecdotes.\n- Embed CTA naturally (call us, get a quote, schedule online) — never feel salesy.\n\nBe specific to ${scopeDisplay}. Output ONLY the JSON, no markdown fence.`;
}

function metaPromptForMetaAgent(scopeDisplay) {
  return `You are designing the Claude system prompt for a "${scopeDisplay}" meta-agent — an agent that evaluates, scores, and improves OTHER agents within the Ant colony platform.\n\nThe agent receives: a target agent's record (id, name, purpose, signal_type, system prompt text), recent operational telemetry (successful invocations, failure rate, average output length, downstream signal pickup rate), human feedback signals (operator approvals/rejections), and optionally a population of similar agents for comparison.\n\nIt must return structured meta-intelligence in this exact shape:\n1. FITNESS SCORE: a 0-100 rating of the target agent's effectiveness, with the single most important driver of the score.\n2. STRENGTHS: top 2 things the target agent is doing well, with telemetry evidence.\n3. WEAKNESSES: top 2 underperformance patterns, with specific failure traces.\n4. REFACTOR PROPOSAL: concrete edits to the agent's system prompt that would improve fitness — formatted as a diff (- old, + new) or "add this section: ...".\n5. CLONE-WORTHINESS: whether this agent's successful patterns are general enough to seed a new agent for a different domain. If yes, the domain mapping (e.g. "the LG brand specialist's 'check PCB ground bond' diagnostic prompt would transfer to Samsung").\n6. APPROVAL GATE: human-readable summary for Teddy to approve before any refactor/clone is committed (300 chars max). When recommending an irreversible action, end with marker token "__OPERATOR_REVIEW__".\n\nBe specific to ${scopeDisplay}. Never recommend deleting or disabling an agent without a 14-day evidence window of poor performance. Never auto-commit refactors — the agent only produces proposals; commit gate is the operator. Output ONLY the system prompt text — no preamble, no commentary.`;
}

function metaPromptForTechLifecycle(scopeDisplay) {
  return `You are designing the Claude system prompt for a "${scopeDisplay}" tech lifecycle agent for TN Appliance Exchange. This agent tracks technicians through their career stages — new-hire confidence-building, first-90-days, certifications, first-visit-fix-rate, TDR quality — and triggers right-moment coaching or recognition.\n\nThe agent receives: tech record (id, hire date, certifications, mentor, current performance metrics), recent activity (jobs, TDRs, customer feedback), and lifecycle stage (new / 30-day / 90-day / certified / veteran).\n\nIt must return structured lifecycle intelligence in this exact shape:\n1. STAGE: where this tech is in their lifecycle, with what milestone is next.\n2. CURRENT SIGNAL: strongest positive AND strongest negative pattern in recent activity.\n3. NEXT INTERVENTION: the single concrete action the system should take this week (certification reminder, mentor check-in, coaching SMS, recognition, etc.).\n4. SMS / MESSAGE: the actual outbound message if applicable (200 chars max), in a respectful direct tone — these are field professionals.\n5. METRIC TO WATCH: the leading indicator that confirms whether the intervention worked.\n\nBe specific to ${scopeDisplay}. Never compare techs to each other in output. Never escalate a single bad job to performance concern. Output ONLY the system prompt text — no preamble.`;
}

function metaPromptForSmsResponder(typeDisplay) {
  return (
    `You are designing the Claude system prompt for a "${typeDisplay}" customer-SMS responder agent. ` +
    `This agent runs inside TN Appliance Exchange's automation platform (Ant). ` +
    `It receives an inbound customer SMS payload — customer name, phone, the body of their incoming message, ` +
    `the job_id they're associated with, and recent context — and must produce a single outbound SMS reply.\n\n` +
    `The agent's domain is "${typeDisplay}" — the type/category of conversation it specializes in (examples: appointment confirmation, ` +
    `parts arrival, reschedule request, payment, post-job feedback, warranty status). Tailor the system prompt to that domain.\n\n` +
    `Hard requirements for the system prompt you write:\n` +
    `1. The agent must produce ONE SMS-length reply (no markdown, no headers, no emoji unless contextually warranted). ` +
    `Target 160 characters but allow up to 300 when the situation justifies it.\n` +
    `2. Always sign off with the company brand cleanly when appropriate ("- TN Appliance Exchange" or "- Ant"). Do not over-brand.\n` +
    `3. If the customer's intent is unclear, the reply must ask one short clarifying question rather than guess.\n` +
    `4. If the customer needs human action (escalation), the reply should say "Hold tight, we're getting a human on this" and the agent ` +
    `must signal escalation upstream by including the marker token "__ESCALATE__" at the end of its output.\n` +
    `5. Never invent specifics not present in the input — no fake appointment times, no fake tech names, no fake part ETAs.\n` +
    `6. Respect quiet hours; if the customer message arrived between 9pm and 8am CT, mention that response time may be slower.\n\n` +
    `Write the system prompt now. Be specific to ${typeDisplay}-type conversations. ` +
    `Output ONLY the system prompt text — no preamble, no commentary, no meta-text.`
  );
}

function metaPromptForResearch(sourceDisplay) {
  return (
    `You are designing the Claude system prompt for a "${sourceDisplay}" research specialist agent. ` +
    `${sourceDisplay} is a repair-data source (e.g., a public API, subscription service, or technical database) that field techs consult for service manuals, ` +
    `wiring diagrams, repair guides, community-validated diagnostic knowledge, and parts data.\n\n` +
    `This agent receives appliance type, brand, model number, and an initial diagnosis. It must format a query optimized for ${sourceDisplay} ` +
    `and return structured repair intelligence in this exact shape:\n` +
    `1. ${sourceDisplay} QUERY: the exact search terms / API parameters this query would use.\n` +
    `2. EXPECTED ARTIFACTS: what types of documents/results ${sourceDisplay} typically returns for this query (service manual, wiring diagram, tech bulletin, community thread, etc.).\n` +
    `3. KEY FINDINGS: the 3 most-likely-relevant pieces of information ${sourceDisplay} would surface for this diagnosis, based on what that source is known for.\n` +
    `4. CONFIDENCE NOTES: how reliable ${sourceDisplay} typically is for this brand/model combination.\n\n` +
    `Be specific to ${sourceDisplay}'s strengths and conventions. ` +
    `Output ONLY the system prompt text — no preamble, no commentary, no meta-text.`
  );
}

// ── Renderers ────────────────────────────────────────────────────

function escapeForBacktick(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function renderDiagnosticSpecialist({ agent, appliance, systemPromptText }) {
  const signalType = `DIAGNOSE_${appliance.toUpperCase()}`;
  const filename = `diagnose_${appliance.toLowerCase()}.js`;
  const safePrompt = escapeForBacktick(systemPromptText);

  const code =
`// Auto-generated by colony_architect on ${new Date().toISOString()}.
// Agent ${agent.id} — ${escapeForBacktick(agent.name || '')}
// Signal: ${signalType}
// Output: emits DIAGNOSTIC_BRIEF for the Research Platform Colony.
//
// To regenerate: delete this file, set the blueprint entry's status back
// to "TO_BUILD", and re-run the architect.

import { config } from '../config.js';

const APPLIANCE = '${appliance}';
const AGENT_ID = '${agent.id}';

const DIAGNOSTIC_PROMPT = \`${safePrompt}\`;

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) throw new Error('payload.job_id required');

  const userMessage = [
    'Brand: ' + (payload.brand || 'unknown'),
    'Model: ' + (payload.model_number || 'unknown'),
    'Customer reports: ' + (payload.problem_summary || '(none)'),
  ].join('\\n');

  const resp = await claude.callClaude({
    system: DIAGNOSTIC_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    model: config.claudeModel,
  });
  const briefText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

  await xano.emitSignal({
    signal_type: 'DIAGNOSTIC_BRIEF',
    signal_strength: 60,
    payload: {
      job_id: jobId,
      appliance_type: APPLIANCE,
      brand: payload.brand || null,
      model_number: payload.model_number || null,
      problem_summary: payload.problem_summary || null,
      brief_text: briefText,
      generated_by: AGENT_ID,
      generated_at_ms: Date.now(),
    },
  });

  const meta = {
    job_id: jobId,
    appliance: APPLIANCE,
    agent_id: AGENT_ID,
    brief_chars: briefText.length,
    outcome: 'diagnostic_brief_emitted',
  };
  await xano.markSignalProcessed(signal.id, 'diagnostic_brief_emitted', meta);
  log('diagnostic_brief_emitted', meta);

  return {
    success: true,
    action: 'diagnostic_brief_emitted',
    job_id: jobId,
    agent_id: AGENT_ID,
  };
}
`;

  return { code, filename, signal_type: signalType };
}

function renderBrandSpecialist({ agent, brandSlug, brandDisplay, systemPromptText }) {
  const signalType = `BRAND_LOOKUP_${brandSlug.toUpperCase()}`;
  // dispatch.js routes by `${signal_type.toLowerCase()}.js` so the filename
  // MUST be brand_lookup_<slug>.js (not brand_<slug>.js). Renaming fix
  // pushed 2026-05-26 — earlier brand_<slug>.js files were never dispatched.
  const filename = `brand_lookup_${brandSlug}.js`;
  const safePrompt = escapeForBacktick(systemPromptText);

  const code =
`// Auto-generated by colony_architect on ${new Date().toISOString()}.
// Agent ${agent.id} — ${escapeForBacktick(agent.name || '')}
// Brand: ${brandDisplay}  (slug: ${brandSlug})
// Signal in:  ${signalType}
// Signal out: BRAND_INTELLIGENCE
//
// Upstream wiring (a future "diagnose_router" agent or job_created fan-out)
// is expected to emit ${signalType} when a job's brand maps to "${brandSlug}".
// Until then this agent sits dormant but ready.

import { config } from '../config.js';

const BRAND_SLUG = '${brandSlug}';
const BRAND_DISPLAY = '${escapeForBacktick(brandDisplay)}';
const AGENT_ID = '${agent.id}';

const BRAND_PROMPT = \`${safePrompt}\`;

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) throw new Error('payload.job_id required');

  const userMessage = [
    'Appliance type: ' + (payload.appliance_type || 'unknown'),
    'Model number: ' + (payload.model_number || 'unknown'),
    'Symptom: ' + (payload.problem_summary || payload.symptom || '(none)'),
  ].join('\\n');

  const resp = await claude.callClaude({
    system: BRAND_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    model: config.claudeModel,
  });
  const intelText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

  await xano.emitSignal({
    signal_type: 'BRAND_INTELLIGENCE',
    signal_strength: 55,
    payload: {
      job_id: jobId,
      brand: BRAND_SLUG,
      brand_display: BRAND_DISPLAY,
      appliance_type: payload.appliance_type || null,
      model_number: payload.model_number || null,
      problem_summary: payload.problem_summary || null,
      intel_text: intelText,
      generated_by: AGENT_ID,
      generated_at_ms: Date.now(),
    },
  });

  const meta = {
    job_id: jobId,
    brand: BRAND_SLUG,
    agent_id: AGENT_ID,
    intel_chars: intelText.length,
    outcome: 'brand_intelligence_emitted',
  };
  await xano.markSignalProcessed(signal.id, 'brand_intelligence_emitted', meta);
  log('brand_intelligence_emitted', meta);

  return { success: true, action: 'brand_intelligence_emitted', job_id: jobId, agent_id: AGENT_ID };
}
`;

  return { code, filename, signal_type: signalType };
}

function renderGenericSpecialist({
  agent,
  slug,
  display,
  systemPromptText,
  // wiring constants
  signalIn,     // e.g. "PARTS_LOOKUP_REFRIGERATOR_PARTS"
  signalOut,    // e.g. "PARTS_INTELLIGENCE"
  filename,     // e.g. "parts_refrigerator_parts.js"
  templateName, // e.g. "parts_intelligence"
  outputKey,    // e.g. "intel_text"
  signalStrength = 55,
  promptVarName, // e.g. "PARTS_PROMPT"
  userMessageLines, // function: (payloadVarName) => string[] (JS source lines)
}) {
  const safePrompt = escapeForBacktick(systemPromptText);
  const userMsgLines = userMessageLines('payload');

  const code =
`// Auto-generated by colony_architect (${templateName}) on ${new Date().toISOString()}.
// Agent ${agent.id} — ${escapeForBacktick(agent.name || '')}
// Specialty: ${display}  (slug: ${slug})
// Signal in:  ${signalIn}
// Signal out: ${signalOut}
//
// Upstream wiring (a future router) is expected to emit ${signalIn} when a
// job matches the "${slug}" specialty. Until then this agent sits dormant
// but ready.

import { config } from '../config.js';

const SPECIALTY_SLUG = '${slug}';
const SPECIALTY_DISPLAY = '${escapeForBacktick(display)}';
const AGENT_ID = '${agent.id}';

const ${promptVarName} = \`${safePrompt}\`;

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const jobId = payload.job_id == null ? null : Number(payload.job_id);

  const userMessage = [
${userMsgLines.map((l) => '    ' + l).join(',\n')}
  ].join('\\n');

  const resp = await claude.callClaude({
    system: ${promptVarName},
    messages: [{ role: 'user', content: userMessage }],
    model: config.claudeModel,
  });
  const outputText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

  await xano.emitSignal({
    signal_type: '${signalOut}',
    signal_strength: ${signalStrength},
    payload: {
      job_id: jobId,
      specialty: SPECIALTY_SLUG,
      specialty_display: SPECIALTY_DISPLAY,
      ${outputKey}: outputText,
      generated_by: AGENT_ID,
      source_signal_id: signal.id,
      generated_at_ms: Date.now(),
    },
  });

  const meta = {
    job_id: jobId,
    specialty: SPECIALTY_SLUG,
    agent_id: AGENT_ID,
    output_chars: outputText.length,
    outcome: '${signalOut.toLowerCase()}_emitted',
  };
  await xano.markSignalProcessed(signal.id, '${signalOut.toLowerCase()}_emitted', meta);
  log('${signalOut.toLowerCase()}_emitted', meta);

  return { success: true, action: meta.outcome, job_id: jobId, agent_id: AGENT_ID };
}
`;

  return { code, filename, signal_type: signalIn };
}

function renderPartsIntelligence({ agent, domainSlug, domainDisplay, systemPromptText }) {
  return renderGenericSpecialist({
    agent,
    slug: domainSlug,
    display: domainDisplay,
    systemPromptText,
    signalIn: `PARTS_LOOKUP_${domainSlug.toUpperCase()}`,
    signalOut: 'PARTS_INTELLIGENCE',
    // Dispatch routes by lowercased signal_type. Filename must match.
    filename: `parts_lookup_${domainSlug}.js`,
    templateName: 'parts_intelligence',
    outputKey: 'intel_text',
    promptVarName: 'PARTS_PROMPT',
    userMessageLines: () => [
      `'Appliance type: ' + (payload.appliance_type || 'unknown')`,
      `'Brand: ' + (payload.brand || 'unknown')`,
      `'Model number: ' + (payload.model_number || 'unknown')`,
      `'Failed component: ' + (payload.failed_component || payload.problem_summary || '(none)')`,
      `'Verified part number (if any): ' + (payload.verified_part_number || '(none)')`,
      `'Symptom: ' + (payload.problem_summary || '(none)')`,
    ],
  });
}

function renderSchedulingOptimizer({ agent, scopeSlug, scopeDisplay, systemPromptText }) {
  return renderGenericSpecialist({
    agent,
    slug: scopeSlug,
    display: scopeDisplay,
    systemPromptText,
    signalIn: `SCHEDULE_REQUEST_${scopeSlug.toUpperCase()}`,
    signalOut: 'SCHEDULING_DECISION',
    filename: `schedule_request_${scopeSlug}.js`,
    templateName: 'scheduling_optimizer',
    outputKey: 'decision_text',
    promptVarName: 'SCHEDULING_PROMPT',
    userMessageLines: () => [
      `'Job ID: ' + (jobId == null ? 'none' : jobId)`,
      `'Appliance type: ' + (payload.appliance_type || 'unknown')`,
      `'Customer zip: ' + (payload.customer_zip || payload.zip || 'unknown')`,
      `'Customer preference: ' + (payload.customer_preference_text || '(none)')`,
      `'Urgency: ' + (payload.scheduling_type || 'standard')`,
      `'Warranty company: ' + (payload.warranty_company || 'self-pay')`,
      `'Available techs (JSON): ' + JSON.stringify(payload.available_techs || [])`,
      `'Constraints (JSON): ' + JSON.stringify(payload.constraints || {})`,
    ],
  });
}

function renderPerformanceCoach({ agent, scopeSlug, scopeDisplay, systemPromptText }) {
  return renderGenericSpecialist({
    agent,
    slug: scopeSlug,
    display: scopeDisplay,
    systemPromptText,
    signalIn: `PERFORMANCE_REQUEST_${scopeSlug.toUpperCase()}`,
    signalOut: 'PERFORMANCE_INSIGHT',
    filename: `performance_request_${scopeSlug}.js`,
    templateName: 'performance_coach',
    outputKey: 'insight_text',
    promptVarName: 'PERFORMANCE_PROMPT',
    userMessageLines: () => [
      `'Tech ID: ' + (payload.tech_id || 'unknown')`,
      `'Tech name: ' + (payload.tech_first_name || payload.tech_name || 'unknown')`,
      `'Window (days): ' + (payload.window_days || 30)`,
      `'Recent TDRs (JSON): ' + JSON.stringify(payload.recent_tdrs || [])`,
      `'Recent jobs (JSON): ' + JSON.stringify(payload.recent_jobs || [])`,
      `'Callback rate: ' + (payload.callback_rate || 'n/a')`,
      `'Feedback signals (JSON): ' + JSON.stringify(payload.feedback || [])`,
    ],
  });
}

function renderSmsResponder({ agent, typeSlug, typeDisplay, systemPromptText }) {
  const signalType = `SMS_RESPONSE_${typeSlug.toUpperCase()}`;
  const filename = `sms_response_${typeSlug}.js`;
  const safePrompt = escapeForBacktick(systemPromptText);

  const code =
`// Auto-generated by colony_architect on ${new Date().toISOString()}.
// Agent ${agent.id} — ${escapeForBacktick(agent.name || '')}
// SMS conversation type: ${typeDisplay}  (slug: ${typeSlug})
// Signal in:  ${signalType}
// Signal out: CUSTOMER_SMS_REPLY (escalates by emitting CUSTOMER_SMS_ESCALATE
// when the reply contains the __ESCALATE__ marker).
//
// Upstream wiring: a future inbound-SMS router emits ${signalType} when an
// incoming SMS matches this conversation type. Until that lands the agent
// sits dormant but ready.

import { config } from '../config.js';

const SMS_TYPE_SLUG = '${typeSlug}';
const SMS_TYPE_DISPLAY = '${escapeForBacktick(typeDisplay)}';
const AGENT_ID = '${agent.id}';

const RESPONDER_PROMPT = \`${safePrompt}\`;

const ESCALATE_MARKER = '__ESCALATE__';

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const jobId = payload.job_id == null ? null : Number(payload.job_id);
  const customerId = payload.customer_id == null ? null : Number(payload.customer_id);

  const userMessage = [
    'Customer name: ' + (payload.customer_name || payload.first_name || 'unknown'),
    'Customer phone: ' + (payload.customer_phone || payload.phone || 'unknown'),
    'Job ID: ' + (jobId == null ? 'none' : jobId),
    'Inbound SMS body: ' + (payload.body || payload.message || '(empty)'),
    'Recent context: ' + (payload.recent_context || '(none)'),
  ].join('\\n');

  const resp = await claude.callClaude({
    system: RESPONDER_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    model: config.claudeModel,
  });
  let replyText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

  const escalate = replyText.includes(ESCALATE_MARKER);
  if (escalate) {
    replyText = replyText.replace(new RegExp(ESCALATE_MARKER, 'g'), '').trim();
  }

  await xano.emitSignal({
    signal_type: 'CUSTOMER_SMS_REPLY',
    signal_strength: escalate ? 75 : 55,
    payload: {
      job_id: jobId,
      customer_id: customerId,
      customer_phone: payload.customer_phone || payload.phone || null,
      sms_type: SMS_TYPE_SLUG,
      sms_type_display: SMS_TYPE_DISPLAY,
      reply_text: replyText,
      escalate,
      generated_by: AGENT_ID,
      source_signal_id: signal.id,
      generated_at_ms: Date.now(),
    },
  });

  if (escalate) {
    await xano.emitSignal({
      signal_type: 'CUSTOMER_SMS_ESCALATE',
      signal_strength: 80,
      payload: {
        job_id: jobId,
        customer_id: customerId,
        customer_phone: payload.customer_phone || payload.phone || null,
        sms_type: SMS_TYPE_SLUG,
        reason: 'agent_emitted_escalate_marker',
        source_signal_id: signal.id,
      },
    });
  }

  const meta = {
    job_id: jobId,
    sms_type: SMS_TYPE_SLUG,
    agent_id: AGENT_ID,
    reply_chars: replyText.length,
    escalate,
    outcome: escalate ? 'sms_reply_emitted_escalated' : 'sms_reply_emitted',
  };
  await xano.markSignalProcessed(signal.id, 'customer_sms_reply_emitted', meta);
  log('customer_sms_reply_emitted', meta);

  return { success: true, action: meta.outcome, job_id: jobId, agent_id: AGENT_ID };
}
`;

  return { code, filename, signal_type: signalType };
}

function renderResearchAgent({ agent, sourceSlug, sourceDisplay, systemPromptText }) {
  const signalType = `RESEARCH_REQUEST_${sourceSlug.toUpperCase()}`;
  const filename = `research_request_${sourceSlug}.js`;
  const safePrompt = escapeForBacktick(systemPromptText);

  const code =
`// Auto-generated by colony_architect on ${new Date().toISOString()}.
// Agent ${agent.id} — ${escapeForBacktick(agent.name || '')}
// Source: ${sourceDisplay}  (slug: ${sourceSlug})
// Signal in:  ${signalType}
// Signal out: RESEARCH_DATA
//
// v0: Claude-only — the system prompt asks Claude to *simulate* what
// ${sourceDisplay} would surface for this query, using model-knowledge.
// v0.5: wire an actual HTTP fetch to ${sourceDisplay}'s API and pass
// the real response back to Claude for structuring.

import { config } from '../config.js';

const SOURCE_SLUG = '${sourceSlug}';
const SOURCE_DISPLAY = '${escapeForBacktick(sourceDisplay)}';
const AGENT_ID = '${agent.id}';

const RESEARCH_PROMPT = \`${safePrompt}\`;

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) throw new Error('payload.job_id required');

  const userMessage = [
    'Appliance type: ' + (payload.appliance_type || 'unknown'),
    'Brand: ' + (payload.brand || 'unknown'),
    'Model number: ' + (payload.model_number || 'unknown'),
    'Initial diagnosis: ' + (payload.diagnosis || payload.problem_summary || '(none)'),
  ].join('\\n');

  const resp = await claude.callClaude({
    system: RESEARCH_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    model: config.claudeModel,
  });
  const dataText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

  await xano.emitSignal({
    signal_type: 'RESEARCH_DATA',
    signal_strength: 55,
    payload: {
      job_id: jobId,
      source: SOURCE_SLUG,
      source_display: SOURCE_DISPLAY,
      appliance_type: payload.appliance_type || null,
      brand: payload.brand || null,
      model_number: payload.model_number || null,
      data_text: dataText,
      generated_by: AGENT_ID,
      generated_at_ms: Date.now(),
    },
  });

  const meta = {
    job_id: jobId,
    source: SOURCE_SLUG,
    agent_id: AGENT_ID,
    data_chars: dataText.length,
    outcome: 'research_data_emitted',
  };
  await xano.markSignalProcessed(signal.id, 'research_data_emitted', meta);
  log('research_data_emitted', meta);

  return { success: true, action: 'research_data_emitted', job_id: jobId, agent_id: AGENT_ID };
}
`;

  return { code, filename, signal_type: signalType };
}

// ── Public entry point ──────────────────────────────────────────

/**
 * Generate a JS agent file for the given blueprint agent.
 * Returns { code, filename, signal_type } on success.
 * Returns null when no template matches.
 * Throws on Claude failure.
 */
export async function generateAgent(agent, claude, config) {
  // Capability-gap → architect feedback loop (#8). When a brain
  // flagged the same gap ≥3 times and the gap was injected into
  // blueprint.capability_gap_specs, pickNextAgent surfaces it with
  // agent.from_capability_gap=true. Use a generic "fill the gap"
  // template: Claude inspects the gap_description + proposed
  // solutions and writes a stub agent file the operator can refine.
  if (agent && agent.from_capability_gap && agent.capability_gap_spec) {
    return generateCapabilityGapAgent(agent.capability_gap_spec, claude, config);
  }

  if (isDiagnosticSpecialist(agent)) {
    const appliance = applianceFromTriggers(agent);
    if (!appliance) {
      throw new Error('diagnostic-specialist template requires appliance_type in triggers');
    }

    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for specialist agents. Output only the prompt text — no commentary, no preamble.',
      messages: [{ role: 'user', content: metaPromptForDiagnostic(appliance) }],
      model: config.claudeModel,
      maxTokens: 2048,
    });
    const promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

    if (!promptText || promptText.length < 60) {
      throw new Error('Claude returned empty/short system prompt for ' + appliance);
    }

    return renderDiagnosticSpecialist({
      agent,
      appliance,
      systemPromptText: promptText,
    });
  }

  if (isBrandSpecialist(agent)) {
    const brandSlug = brandFromAgent(agent);
    if (!brandSlug) {
      throw new Error('brand-specialist template requires brand in name or triggers');
    }
    const brandDisplay = brandDisplayFromAgent(agent, brandSlug);

    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for specialist agents. Output only the prompt text — no commentary, no preamble.',
      messages: [{ role: 'user', content: metaPromptForBrand(brandDisplay) }],
      model: config.claudeModel,
      maxTokens: 2048,
    });
    const promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

    if (!promptText || promptText.length < 60) {
      throw new Error('Claude returned empty/short system prompt for brand ' + brandSlug);
    }

    return renderBrandSpecialist({
      agent,
      brandSlug,
      brandDisplay,
      systemPromptText: promptText,
    });
  }

  if (isSmsResponder(agent)) {
    const typeSlug = smsTypeFromAgent(agent);
    if (!typeSlug) {
      throw new Error('sms-responder template requires SMS type in name or triggers');
    }
    const typeDisplay = smsTypeDisplayFromAgent(agent, typeSlug);

    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for specialist agents. Output only the prompt text — no commentary, no preamble.',
      messages: [{ role: 'user', content: metaPromptForSmsResponder(typeDisplay) }],
      model: config.claudeModel,
      maxTokens: 2048,
    });
    const promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

    if (!promptText || promptText.length < 60) {
      throw new Error('Claude returned empty/short system prompt for sms type ' + typeSlug);
    }

    return renderSmsResponder({
      agent,
      typeSlug,
      typeDisplay,
      systemPromptText: promptText,
    });
  }

  if (isResearchAgent(agent)) {
    const sourceSlug = sourceFromAgent(agent);
    if (!sourceSlug) {
      throw new Error('research template requires source name on agent');
    }
    const sourceDisplay = sourceDisplayFromAgent(agent, sourceSlug);

    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for specialist agents. Output only the prompt text — no commentary, no preamble.',
      messages: [{ role: 'user', content: metaPromptForResearch(sourceDisplay) }],
      model: config.claudeModel,
      maxTokens: 2048,
    });
    const promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

    if (!promptText || promptText.length < 60) {
      throw new Error('Claude returned empty/short system prompt for source ' + sourceSlug);
    }

    return renderResearchAgent({
      agent,
      sourceSlug,
      sourceDisplay,
      systemPromptText: promptText,
    });
  }

  if (isPartsIntelligence(agent)) {
    const domainSlug = partsDomainFromAgent(agent);
    if (!domainSlug) {
      throw new Error('parts-intelligence template requires a name or trigger to derive a domain slug');
    }
    const domainDisplay = partsDomainDisplay(agent, domainSlug);

    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for specialist agents. Output only the prompt text — no commentary, no preamble.',
      messages: [{ role: 'user', content: metaPromptForParts(domainDisplay) }],
      model: config.claudeModel,
      maxTokens: 2048,
    });
    const promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

    if (!promptText || promptText.length < 60) {
      throw new Error('Claude returned empty/short system prompt for parts domain ' + domainSlug);
    }

    return renderPartsIntelligence({
      agent,
      domainSlug,
      domainDisplay,
      systemPromptText: promptText,
    });
  }

  if (isSchedulingOptimizer(agent)) {
    const scopeSlug = schedulingScopeFromAgent(agent);
    if (!scopeSlug) {
      throw new Error('scheduling-optimizer template requires a name or trigger to derive a scope slug');
    }
    const scopeDisplay = schedulingScopeDisplay(agent, scopeSlug);

    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for specialist agents. Output only the prompt text — no commentary, no preamble.',
      messages: [{ role: 'user', content: metaPromptForScheduling(scopeDisplay) }],
      model: config.claudeModel,
      maxTokens: 2048,
    });
    const promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

    if (!promptText || promptText.length < 60) {
      throw new Error('Claude returned empty/short system prompt for scheduling scope ' + scopeSlug);
    }

    return renderSchedulingOptimizer({
      agent,
      scopeSlug,
      scopeDisplay,
      systemPromptText: promptText,
    });
  }

  if (isPerformanceCoach(agent)) {
    const scopeSlug = performanceScopeFromAgent(agent);
    if (!scopeSlug) {
      throw new Error('performance-coach template requires a name or trigger to derive a scope slug');
    }
    const scopeDisplay = performanceScopeDisplay(agent, scopeSlug);

    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for specialist agents. Output only the prompt text — no commentary, no preamble.',
      messages: [{ role: 'user', content: metaPromptForPerformance(scopeDisplay) }],
      model: config.claudeModel,
      maxTokens: 2048,
    });
    const promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();

    if (!promptText || promptText.length < 60) {
      throw new Error('Claude returned empty/short system prompt for performance scope ' + scopeSlug);
    }

    return renderPerformanceCoach({
      agent,
      scopeSlug,
      scopeDisplay,
      systemPromptText: promptText,
    });
  }

  // ── COLONY BUILD MODE templates — 10 high-leverage detectors ──
  // Each follows the same pattern: detect → derive slug → Claude meta-prompt
  // → renderGenericSpecialist. Slugs default to agent.id when nothing else
  // fits, so detection alone is enough to build.

  async function generateFromGenericTemplate({
    metaPrompt,
    signalOutType,
    signalInPrefix,
    filenamePrefix,
    templateName,
    promptVarName,
    outputKey,
    payloadFields,
    nameSuffixRegex,
  }) {
    const slug = _slugFromName(agent.name, nameSuffixRegex) || String(agent.id || '').toLowerCase();
    const display = _displayFromName(agent.name, slug, nameSuffixRegex);

    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for specialist agents. Output only the prompt text — no commentary, no preamble.',
      messages: [{ role: 'user', content: metaPrompt(display) }],
      model: config.claudeModel,
      maxTokens: 2048,
    });
    const promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();
    if (!promptText || promptText.length < 60) {
      throw new Error(`Claude returned empty/short system prompt for ${templateName} ${slug}`);
    }

    // Dispatch routes by lowercased signal_type. Always derive the filename
    // from signalInPrefix so they match (the per-template filenamePrefix
    // override was the source of the 2026-05-26 systemic mismatch bug).
    const derivedFilenamePrefix = signalInPrefix.toLowerCase();

    return renderGenericSpecialist({
      agent,
      slug,
      display,
      systemPromptText: promptText,
      signalIn: `${signalInPrefix}${slug.toUpperCase()}`,
      signalOut: signalOutType,
      filename: `${derivedFilenamePrefix}${slug}.js`,
      templateName,
      outputKey,
      promptVarName,
      userMessageLines: () => payloadFields,
    });
  }

  if (isRecruitingSpecialist(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForRecruiting,
      signalOutType: 'RECRUITING_INSIGHT',
      signalInPrefix: 'RECRUITING_REQUEST_',
      filenamePrefix: 'recruiting_',
      templateName: 'recruiting_specialist',
      promptVarName: 'RECRUITING_PROMPT',
      outputKey: 'insight_text',
      payloadFields: [
        `'Channel: ' + (payload.channel || 'unknown')`,
        `'Role: ' + (payload.role || 'appliance tech')`,
        `'Funnel snapshot (JSON): ' + JSON.stringify(payload.funnel || {})`,
        `'Candidate (JSON): ' + JSON.stringify(payload.candidate || {})`,
        `'Market signal: ' + (payload.market_signal || '(none)')`,
        `'Recent actions (JSON): ' + JSON.stringify(payload.recent_actions || [])`,
      ],
      nameSuffixRegex: /\s*(Recruiting|Agent)$/gi,
    });
  }

  if (isHvacSpecialist(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForHvac,
      signalOutType: 'HVAC_INTELLIGENCE',
      signalInPrefix: 'HVAC_REQUEST_',
      filenamePrefix: 'hvac_',
      templateName: 'hvac_specialist',
      promptVarName: 'HVAC_PROMPT',
      outputKey: 'intel_text',
      payloadFields: [
        `'Job ID: ' + (jobId == null ? 'none' : jobId)`,
        `'Brand: ' + (payload.brand || 'unknown')`,
        `'Model: ' + (payload.model_number || 'unknown')`,
        `'Equipment age (years): ' + (payload.equipment_age_years || 'unknown')`,
        `'Refrigerant type: ' + (payload.refrigerant_type || 'unknown')`,
        `'Symptom: ' + (payload.problem_summary || '(none)')`,
        `'Service history (JSON): ' + JSON.stringify(payload.service_history || [])`,
      ],
      nameSuffixRegex: /\s*(HVAC|Agent)$/gi,
    });
  }

  if (isMentorshipSpecialist(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForMentorship,
      signalOutType: 'MENTORSHIP_INSIGHT',
      signalInPrefix: 'MENTORSHIP_REQUEST_',
      filenamePrefix: 'mentorship_',
      templateName: 'mentorship_specialist',
      promptVarName: 'MENTORSHIP_PROMPT',
      outputKey: 'insight_text',
      payloadFields: [
        `'Mentor (JSON): ' + JSON.stringify(payload.mentor || {})`,
        `'Mentees (JSON): ' + JSON.stringify(payload.mentees || [])`,
        `'Pairing history (JSON): ' + JSON.stringify(payload.pairing_history || [])`,
        `'Recent flags (JSON): ' + JSON.stringify(payload.flags || [])`,
        `'Trigger event: ' + (payload.trigger_event || '(periodic check)')`,
      ],
      nameSuffixRegex: /\s*(Mentor|Mentorship|Agent)$/gi,
    });
  }

  if (isWarrantyClaims(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForWarrantyClaims,
      signalOutType: 'WARRANTY_CLAIM_ACTION',
      signalInPrefix: 'WARRANTY_CLAIM_REQUEST_',
      filenamePrefix: 'warranty_',
      templateName: 'warranty_claims',
      promptVarName: 'WARRANTY_PROMPT',
      outputKey: 'claim_action_text',
      payloadFields: [
        `'Job ID: ' + (jobId == null ? 'none' : jobId)`,
        `'Vendor: ' + (payload.warranty_company || payload.vendor || 'unknown')`,
        `'Action: ' + (payload.action || 'submit')`,
        `'TDR (JSON): ' + JSON.stringify(payload.tdr || {})`,
        `'Completion type: ' + (payload.completion_type || 'unknown')`,
        `'Prior outcomes (JSON): ' + JSON.stringify(payload.prior_outcomes || [])`,
        `'Portal requirements (JSON): ' + JSON.stringify(payload.portal_requirements || {})`,
      ],
      nameSuffixRegex: /\s*(Claims|Claim|Warranty|Agent)$/gi,
    });
  }

  if (isServiceAgreementSpecialist(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForServiceAgreement,
      signalOutType: 'SERVICE_AGREEMENT_INSIGHT',
      signalInPrefix: 'SERVICE_AGREEMENT_REQUEST_',
      filenamePrefix: 'service_agreement_',
      templateName: 'service_agreement_specialist',
      promptVarName: 'SERVICE_AGREEMENT_PROMPT',
      outputKey: 'insight_text',
      payloadFields: [
        `'Customer ID: ' + (payload.customer_id || 'unknown')`,
        `'Customer (JSON): ' + JSON.stringify(payload.customer || {})`,
        `'Appliance inventory (JSON): ' + JSON.stringify(payload.appliance_inventory || [])`,
        `'Current agreement: ' + (payload.current_agreement || '(none)')`,
        `'Trigger event: ' + (payload.trigger_event || 'periodic')`,
        `'Seasonal context: ' + (payload.season || 'unknown')`,
      ],
      nameSuffixRegex: /\s*(Service\s+Agreement|Agreement|Maintenance|Agent)$/gi,
    });
  }

  if (isBusinessIntelligence(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForBusinessIntelligence,
      signalOutType: 'BUSINESS_INTEL_INSIGHT',
      signalInPrefix: 'BUSINESS_INTEL_REQUEST_',
      filenamePrefix: 'business_intel_request_',
      templateName: 'business_intelligence',
      promptVarName: 'BUSINESS_INTEL_PROMPT',
      outputKey: 'insight_text',
      payloadFields: [
        `'Window: ' + (payload.window || 'daily')`,
        `'Data slice (JSON): ' + JSON.stringify(payload.data || {})`,
        `'Baseline (JSON): ' + JSON.stringify(payload.baseline || {})`,
        `'Thresholds (JSON): ' + JSON.stringify(payload.thresholds || {})`,
        `'Trigger event: ' + (payload.trigger_event || 'scheduled')`,
      ],
      nameSuffixRegex: /\s*(Business\s+Intel|Tracker|Reporter|Watcher|Analyzer|Forecaster|Reconciler|Agent)$/gi,
    });
  }

  if (isCustomerIntelligence(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForCustomerIntelligence,
      signalOutType: 'CUSTOMER_INTELLIGENCE',
      signalInPrefix: 'CUSTOMER_INTELLIGENCE_REQUEST_',
      filenamePrefix: 'customer_intel_',
      templateName: 'customer_intelligence',
      promptVarName: 'CUSTOMER_INTEL_PROMPT',
      outputKey: 'intel_text',
      payloadFields: [
        `'Customer ID: ' + (payload.customer_id || 'unknown')`,
        `'Customer (JSON): ' + JSON.stringify(payload.customer || {})`,
        `'Job history (JSON): ' + JSON.stringify(payload.job_history || [])`,
        `'Appliance inventory (JSON): ' + JSON.stringify(payload.appliance_inventory || [])`,
        `'Feedback signals (JSON): ' + JSON.stringify(payload.feedback || [])`,
      ],
      nameSuffixRegex: /\s*(Customer|Agent)$/gi,
    });
  }

  if (isVoicePromptOptimizer(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForVoicePrompt,
      signalOutType: 'VOICE_PROMPT_PROPOSAL',
      signalInPrefix: 'VOICE_PROMPT_REQUEST_',
      filenamePrefix: 'voice_prompt_',
      templateName: 'voice_prompt_optimizer',
      promptVarName: 'VOICE_PROMPT_PROMPT',
      outputKey: 'proposal_text',
      payloadFields: [
        `'Vapi/SMS agent: ' + (payload.target_agent || 'unknown')`,
        `'Current system prompt (JSON): ' + JSON.stringify(payload.current_system_prompt || '')`,
        `'Transcript: ' + (payload.transcript || '(none)')`,
        `'Outcome: ' + (payload.outcome || 'unknown')`,
        `'Failure points (JSON): ' + JSON.stringify(payload.failure_points || [])`,
      ],
      nameSuffixRegex: /\s*(Vapi|Voice|Prompt|Agent)$/gi,
    });
  }

  if (isMarketIntelligence(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForMarketIntelligence,
      signalOutType: 'MARKET_INTELLIGENCE',
      signalInPrefix: 'MARKET_INTELLIGENCE_REQUEST_',
      filenamePrefix: 'market_',
      templateName: 'market_intelligence',
      promptVarName: 'MARKET_PROMPT',
      outputKey: 'intel_text',
      payloadFields: [
        `'Signal payload (JSON): ' + JSON.stringify(payload.signal || {})`,
        `'Historical context (JSON): ' + JSON.stringify(payload.history || [])`,
        `'Current company position (JSON): ' + JSON.stringify(payload.company_position || {})`,
        `'Geography: ' + (payload.region || 'unknown')`,
      ],
      nameSuffixRegex: /\s*(Intelligence|Scout|Forecaster|Agent)$/gi,
    });
  }

  if (isInfrastructureMonitor(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForInfrastructure,
      signalOutType: 'INFRASTRUCTURE_INSIGHT',
      signalInPrefix: 'INFRASTRUCTURE_REQUEST_',
      filenamePrefix: 'infrastructure_',
      templateName: 'infrastructure_monitor',
      promptVarName: 'INFRA_PROMPT',
      outputKey: 'insight_text',
      payloadFields: [
        `'Telemetry (JSON): ' + JSON.stringify(payload.telemetry || {})`,
        `'Recent events (JSON): ' + JSON.stringify(payload.recent_events || [])`,
        `'Queue depths (JSON): ' + JSON.stringify(payload.queues || {})`,
        `'Error rates (JSON): ' + JSON.stringify(payload.error_rates || {})`,
      ],
      nameSuffixRegex: /\s*(Monitor|Agent|Infrastructure)$/gi,
    });
  }

  if (isMetaAgent(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForMetaAgent,
      signalOutType: 'META_AGENT_INSIGHT',
      signalInPrefix: 'META_AGENT_REQUEST_',
      filenamePrefix: 'meta_agent_',
      templateName: 'meta_agent',
      promptVarName: 'META_AGENT_PROMPT',
      outputKey: 'insight_text',
      payloadFields: [
        `'Target agent id: ' + (payload.target_agent_id || 'unknown')`,
        `'Target agent record (JSON): ' + JSON.stringify(payload.target_agent || {})`,
        `'Telemetry (JSON): ' + JSON.stringify(payload.telemetry || {})`,
        `'Operator feedback (JSON): ' + JSON.stringify(payload.feedback || [])`,
        `'Population (JSON): ' + JSON.stringify(payload.population || [])`,
      ],
      nameSuffixRegex: /\s*(Scorer|Cloner|Evaluator|Meta|Agent)$/gi,
    });
  }

  if (isContentGenerator(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForContentGenerator,
      signalOutType: 'CONTENT_GENERATED',
      signalInPrefix: 'CONTENT_GENERATOR_REQUEST_',
      filenamePrefix: 'content_',
      templateName: 'content_generator',
      promptVarName: 'CONTENT_PROMPT',
      outputKey: 'content_text',
      payloadFields: [
        `'Topic / brief: ' + (payload.topic || 'general')`,
        `'Voice / persona: ' + (payload.persona || 'TN Appliance company voice')`,
        `'Tone constraints: ' + (payload.tone || 'friendly, specific, helpful')`,
        `'Length target words: ' + (payload.length_words || 400)`,
        `'Extra context (JSON): ' + JSON.stringify(payload.context || {})`,
      ],
      nameSuffixRegex: /\s*(Writer|Generator|Post|Story|Recap|Spotlight|Refresher)$/gi,
    });
  }

  if (isTechLifecycle(agent)) {
    return generateFromGenericTemplate({
      metaPrompt: metaPromptForTechLifecycle,
      signalOutType: 'TECH_LIFECYCLE_INSIGHT',
      signalInPrefix: 'TECH_LIFECYCLE_REQUEST_',
      filenamePrefix: 'tech_lifecycle_',
      templateName: 'tech_lifecycle',
      promptVarName: 'TECH_LIFECYCLE_PROMPT',
      outputKey: 'insight_text',
      payloadFields: [
        `'Tech ID: ' + (payload.tech_id || 'unknown')`,
        `'Tech (JSON): ' + JSON.stringify(payload.tech || {})`,
        `'Lifecycle stage: ' + (payload.lifecycle_stage || 'unknown')`,
        `'Recent activity (JSON): ' + JSON.stringify(payload.recent_activity || [])`,
        `'Certifications (JSON): ' + JSON.stringify(payload.certifications || [])`,
      ],
      nameSuffixRegex: /\s*(Tracker|Confidence|Coach|Agent)$/gi,
    });
  }

  return null;
}

// ── Capability-gap auto-builder (#8 architect loop) ──────────────
// When 3+ brain_capability_gap events share a signature, the
// capability_gap_to_blueprint agent writes a CGS entry. pickNextAgent
// surfaces it to the architect. THIS function turns the spec into a
// working agent stub.
//
// The generated agent listens on a CAPABILITY_GAP_REQUEST_<signature>
// signal, calls Claude for a best-effort response, and SMSes Teddy
// the output for review. Operator can then refine the prompt + tool
// list as the gap becomes well-understood.
async function generateCapabilityGapAgent(spec, claude, config) {
  const signature = String(spec.signature || 'unknown').replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
  const agentId = String(spec.id || `cgs_${signature}_${Date.now().toString(36)}`).slice(0, 64);
  const filename = `capability_gap_${signature}.js`;
  const signalType = `CAPABILITY_GAP_REQUEST_${signature.toUpperCase()}`;

  // Ask Claude for a focused proposal of how a brain should handle
  // this gap — what the agent's role is + which tools it would call.
  const meta = `A brain in the Ant ops platform has repeatedly hit this capability gap:

${(spec.sample_descriptions || []).map((s, i) => `  ${i + 1}. ${s}`).join('\n')}

Proposed solutions the brain suggested:
${(spec.sample_proposed_solutions || []).map((s, i) => `  ${i + 1}. ${s}`).join('\n')}

Hit count: ${spec.hit_count || 0}. Brains affected: ${(spec.brains || []).join(', ')}.

Write a SHORT system prompt (under 200 words) for an agent that handles this gap. The agent will receive a signal payload via Claude and reply with text that the platform routes back to Teddy or the originating brain. Reply with ONLY the prompt text, no preamble.`;

  let promptText = '';
  try {
    const resp = await claude.callClaude({
      system: 'You write Claude system prompts for narrowly-scoped specialist agents. Output only the prompt text — no commentary, no markdown fences.',
      messages: [{ role: 'user', content: meta }],
      model: config.claudeModel,
      maxTokens: 800,
    });
    promptText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();
  } catch (_) {}

  if (!promptText || promptText.length < 40) {
    promptText = `You handle a brain capability gap with signature "${signature}". Respond with a concise plan or answer based on the signal payload. If you cannot, return "ESCALATE" and Teddy will pick it up.`;
  }

  const code = `// Auto-generated by colony_architect (capability_gap template) on ${new Date().toISOString()}.
// SIGNATURE: ${signature}
// HIT COUNT (when proposed): ${spec.hit_count || 0}
// BRAINS THAT FLAGGED: ${(spec.brains || []).join(', ')}
//
// SAMPLE DESCRIPTIONS the brains gave:
${(spec.sample_descriptions || []).map((s) => '//   - ' + String(s).slice(0, 150)).join('\n')}
//
// PROPOSED SOLUTIONS the brains suggested:
${(spec.sample_proposed_solutions || []).map((s) => '//   - ' + String(s).slice(0, 150)).join('\n')}
//
// Refine the prompt + tool list as you understand the gap better.
// File: ${filename}
// Signal: ${signalType}

const AGENT_ID = ${JSON.stringify(agentId)};
const SIGNAL_TYPE = ${JSON.stringify(signalType)};

const SYSTEM_PROMPT = ${JSON.stringify(promptText)};

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANT_MODEL = process.env.ANT_CAPABILITY_GAP_MODEL || 'claude-sonnet-4-5-20250929';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};

  if (!ANTHROPIC_KEY) {
    await xano.markSignalProcessed(signal.id, 'capability_gap_handled', {
      outcome: 'skipped_no_key',
    });
    return { success: false, action: 'skipped_no_key' };
  }

  let reply = '';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANT_MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(payload).slice(0, 4000) }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      const data = await r.json();
      reply = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    }
  } catch (e) {
    log('capability_gap_call_failed', { error: String(e) });
  }

  if (!reply || reply.toUpperCase().includes('ESCALATE')) {
    try {
      await sms.toOwner(\`[ant] capability gap ${signature} fired — couldn't auto-answer. Payload: \${JSON.stringify(payload).slice(0, 200)}\`, { call_site: AGENT_ID });
    } catch (_) {}
    await xano.markSignalProcessed(signal.id, 'capability_gap_handled', {
      outcome: 'escalated', payload_preview: JSON.stringify(payload).slice(0, 400),
    });
    return { success: true, action: 'escalated' };
  }

  try {
    await sms.toOwner(\`[ant] capability gap ${signature}: \${reply.slice(0, 300)}\`, { call_site: AGENT_ID });
  } catch (_) {}

  await xano.markSignalProcessed(signal.id, 'capability_gap_handled', {
    outcome: 'auto_answered',
    reply_preview: reply.slice(0, 400),
  });
  return { success: true, action: 'auto_answered' };
}
`;

  return {
    filename,
    code,
    meta: {
      type: 'capability_gap',
      signature,
      signal_type: signalType,
      generated_by: agentId,
      generated_at_ms: Date.now(),
    },
  };
}
