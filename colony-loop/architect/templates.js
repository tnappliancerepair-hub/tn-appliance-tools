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
//   diagnostic_specialist — DIAGNOSTIC_BRIEF emitter, triggered by
//                           DIAGNOSE_<APPLIANCE> signals
//   brand_specialist      — BRAND_INTELLIGENCE emitter, triggered by
//                           BRAND_LOOKUP_<BRAND> signals
//   research_specialist   — RESEARCH_DATA emitter, triggered by
//                           RESEARCH_REQUEST_<SOURCE> signals
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

  return null;
}
