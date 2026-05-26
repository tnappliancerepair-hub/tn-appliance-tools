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
//   diagnostic_specialist  — DIAGNOSTIC_BRIEF emitter, triggered by
//                            DIAGNOSE_<APPLIANCE> signals
//   brand_specialist       — BRAND_INTELLIGENCE emitter, triggered by
//                            BRAND_LOOKUP_<BRAND> signals
//   research_specialist    — RESEARCH_DATA emitter, triggered by
//                            RESEARCH_REQUEST_<SOURCE> signals
//   sms_responder          — CUSTOMER_SMS_REPLY emitter, triggered by
//                            SMS_RESPONSE_<TYPE> signals
//   parts_intelligence     — PARTS_INTELLIGENCE emitter, triggered by
//                            PARTS_LOOKUP_<DOMAIN> signals
//   scheduling_optimizer   — SCHEDULING_DECISION emitter, triggered by
//                            SCHEDULE_REQUEST_<TYPE> signals
//   performance_coach      — PERFORMANCE_INSIGHT emitter, triggered by
//                            PERFORMANCE_REQUEST_<SCOPE> signals
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
  return /RESEARCH_DATA/i.test(outputs);
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
  return /\bschedul\w*|\brout(e|ing)\b|\bcapacit\w*|\bavailabilit\w*|\bdispatch|\bslot|\bcalendar|\bgap[\- ]?fill/.test(combined);
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

function isPerformanceCoach(agent) {
  const outputs = (agent.outputs || []).join(' ');
  if (/PERFORMANCE_INSIGHT|COACHING_RECOMMENDATION/i.test(outputs)) return true;

  const purpose = String(agent.purpose || agent.description || '').toLowerCase();
  const name = String(agent.name || '').toLowerCase();
  const combined = purpose + ' ' + name;
  // Keep narrow — "performance" only when tied to tech/coaching/metrics/TDR context.
  return (
    /\btech\s+performance\b|\bperformance\s+coach|\bcoach(ing)?\b|\bmetric\w*\s+coach|\btdr\s+quality|\bquality\s+of\s+(work|tdr|repair)/.test(combined)
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
  // e.g. "JOB_CREATED with appliance_type=washer"
  const text = (agent.triggers || []).join(' ');
  const m = text.match(/appliance_type\s*=\s*([a-z_]+)/i);
  return m ? m[1].toLowerCase() : null;
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

function metaPromptForDiagnostic(appliance) {
  return (
    `You are designing the Claude system prompt for a "${appliance} diagnostic specialist" agent. ` +
    `This agent receives one job: brand, model number, and customer-reported problem text. ` +
    `It must produce the top 3 likely failure modes ranked by probability. For each failure mode include:\n` +
    `  - one-sentence "confirm with:" evidence the tech should look for to verify\n` +
    `  - common OEM part number(s) when known\n` +
    `  - typical labor time in minutes\n\n` +
    `Write the system prompt now. Be specific to ${appliance}s across major brands (Whirlpool, GE, LG, Samsung, Maytag, Frigidaire, KitchenAid). ` +
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
  const filename = `brand_${brandSlug}.js`;
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
    filename: `parts_${domainSlug}.js`,
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
    filename: `schedule_${scopeSlug}.js`,
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
    filename: `performance_${scopeSlug}.js`,
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
  const filename = `research_${sourceSlug}.js`;
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

  return null;
}
