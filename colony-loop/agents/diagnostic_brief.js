// Handles DIAGNOSTIC_BRIEF signals (emitted by every diagnose_*.js agent
// after Claude generates the top-3 failure-mode brief).
//
// Responsibility: chain the brand-intelligence step. Normalizes the job's
// brand string into one of the 5 architect-built brand slugs and emits
// BRAND_LOOKUP_<SLUG>. The matching brand_*.js agent (Whirlpool family,
// GE, LG, Samsung, Electrolux family) then runs Claude with its brand-
// specific prompt and emits BRAND_INTELLIGENCE.
//
// Why a router (not inline in each diagnose_*.js): same pattern as
// tdr_complete.js (WARRANTY_CLAIM_REQUEST_<VENDOR>). One file owns the
// mapping; new brand agents register here without touching diagnose_*.
//
// Chain: JOB_CREATED → DIAGNOSE_<APPLIANCE> → DIAGNOSTIC_BRIEF
//        → BRAND_LOOKUP_<SLUG> → BRAND_INTELLIGENCE
//        → (future) pre-filled TDR suggestion

// Maps lowercased brand strings to architect-built brand agent slugs.
// Anything not matching this map falls through to "no_brand_agent" (silent
// skip) — adding a new brand agent is a one-line edit here.
const BRAND_MAP = {
  whirlpool: 'whirlpool_family',
  maytag: 'whirlpool_family',
  kitchenaid: 'whirlpool_family',
  amana: 'whirlpool_family',
  'jenn-air': 'whirlpool_family',
  jennair: 'whirlpool_family',
  'whirlpool family': 'whirlpool_family',
  ge: 'ge',
  'g.e.': 'ge',
  general: 'ge',
  'general electric': 'ge',
  hotpoint: 'ge',
  monogram: 'ge',
  cafe: 'ge',
  profile: 'ge',
  lg: 'lg',
  samsung: 'samsung',
  electrolux: 'electrolux_family',
  frigidaire: 'electrolux_family',
  'electrolux family': 'electrolux_family',
  'electrolux frigidaire': 'electrolux_family',
};

function brandSlug(raw) {
  const k = String(raw || '').trim().toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!k) return null;
  if (BRAND_MAP[k]) return BRAND_MAP[k];
  // try first-word match (e.g. "frigidaire affinity" → "frigidaire")
  const firstWord = k.split(' ')[0];
  return BRAND_MAP[firstWord] || null;
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'diagnostic_brief_routed', { outcome: 'skipped_missing_job_id' });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  const slug = brandSlug(payload.brand);
  if (!slug) {
    const meta = {
      job_id: jobId,
      outcome: 'no_brand_agent',
      brand_raw: payload.brand || '',
      appliance_type: payload.appliance_type || '',
    };
    await xano.markSignalProcessed(signal.id, 'diagnostic_brief_routed', meta);
    log('diagnostic_brief_routed', meta);
    return { success: true, action: 'no_brand_agent', job_id: jobId };
  }

  const targetSignal = `BRAND_LOOKUP_${slug.toUpperCase()}`;
  let routedSignalId = null;
  try {
    const emit = await xano.emitSignal({
      signal_type: targetSignal,
      signal_strength: 55,
      payload: {
        job_id: jobId,
        appliance_type: payload.appliance_type || '',
        brand: payload.brand || '',
        brand_slug: slug,
        model_number: payload.model_number || '',
        problem_summary: payload.problem_summary || '',
        prior_diagnostic_brief: payload.brief_text || '',
        source: 'diagnostic_brief_router',
        source_signal_id: signal.id,
      },
    });
    routedSignalId = emit && (emit.signal_id || emit.id);
  } catch (err) {
    log('brand_lookup_emit_failed', { job_id: jobId, slug, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    outcome: 'routed_to_brand_agent',
    brand_raw: payload.brand || '',
    brand_slug: slug,
    target_signal: targetSignal,
    routed_signal_id: routedSignalId,
  };
  await xano.markSignalProcessed(signal.id, 'diagnostic_brief_routed', meta);
  log('diagnostic_brief_routed', meta);

  return { success: true, action: 'routed_to_brand_agent', job_id: jobId, brand_slug: slug };
}
