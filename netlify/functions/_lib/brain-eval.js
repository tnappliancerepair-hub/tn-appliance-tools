// brain-eval.js — forward-eval harness for the troubleshooting brain (the linchpin).
//
// Logs every prediction the brain makes BEFORE the job closes, then grades it
// against the actual fix when the job completes → leak-proof by construction.
// Sliced accuracy (top-1 / top-3 / component) per appliance/brand drives the
// nightly scorecard. Canonical spec: docs/intelligence-architecture.md §Layer 4.
//
// BEST-EFFORT + NO-OP-SAFE: if Supabase isn't configured, every call silently
// skips — this must NEVER break the brain's hot path. Activate by vaulting
// SUPABASE_URL + SUPABASE_SERVICE_KEY and running docs/sql/001_brain_eval.sql.
'use strict';

const sb = require('./supabase');
const TABLE = 'brain_predictions';

// Normalize a part number for comparison: uppercase, drop non-alphanumerics.
// Kills the most common false mismatch (case + dashes/spaces: "w10-190 965" ==
// "W10190965"). NOTE: true OEM<->aftermarket<->superseded equivalence is a later
// upgrade (Marcone/mSupply supersession map) — this is the cheap 80%.
function normalizePart(p) {
  return String(p == null ? '' : p).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Normalize a component name to alphanumeric-lowercase so "Ice Maker" == "icemaker".
function normalizeComponent(c) {
  return String(c == null ? '' : c).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Grade a stored prediction against the actual fix. Pure — unit-tested, no I/O.
//   pred.pred_parts = [{part, confidence}, ...] ranked (strings also accepted)
//   outcome = { actual_part, actual_component }
function gradeAgainstOutcome(pred, outcome) {
  const parts = Array.isArray(pred && pred.pred_parts) ? pred.pred_parts : [];
  const ranked = parts.map((x) => normalizePart(x && typeof x === 'object' ? (x.part ?? x.part_number ?? '') : x));
  const actualPart = normalizePart(outcome && outcome.actual_part);
  const hit_top1 = !!actualPart && ranked.length > 0 && ranked[0] === actualPart;
  const hit_top3 = !!actualPart && ranked.slice(0, 3).includes(actualPart);

  const pc = normalizeComponent(pred && pred.pred_component);
  const ac = normalizeComponent(outcome && outcome.actual_component);
  const component_hit = !!ac && !!pc && (pc === ac || pc.includes(ac) || ac.includes(pc));

  return { hit_top1, hit_top3, component_hit };
}

// logPrediction — call wherever the brain predicts (intake / pre-diagnosis).
// Best-effort: never throws into the caller's hot path.
async function logPrediction(p) {
  try {
    if (!(await sb.isConnected())) return { ok: false, skipped: 'supabase_not_configured' };
    await sb.insert(TABLE, {
      job_id: p.job_id != null ? Number(p.job_id) : null,
      context: p.context || 'intake',
      appliance: p.appliance || null,
      brand: p.brand || null,
      model: p.model || null,
      symptom: p.symptom || null,
      pred_parts: Array.isArray(p.pred_parts) ? p.pred_parts : [],
      pred_component: p.pred_component || null,
      top_confidence: p.top_confidence != null ? Number(p.top_confidence) : null,
      grounded: p.grounded != null ? !!p.grounded : null,
      company_id: p.company_id != null ? Number(p.company_id) : 1,
    });
    return { ok: true };
  } catch (err) {
    console.error('[brain-eval.logPrediction] ' + (err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
}

// gradeJob — when a job closes, grade its ungraded prediction(s) against the fix.
//   outcome = { actual_part, actual_component, source }
async function gradeJob(jobId, outcome) {
  try {
    if (!(await sb.isConnected())) return { ok: false, skipped: 'supabase_not_configured' };
    const rows = await sb.select(TABLE, {
      job_id: 'eq.' + Number(jobId),
      graded_at: 'is.null',
      order: 'made_at.asc',
    });
    let graded = 0;
    for (const pred of rows || []) {
      const g = gradeAgainstOutcome(pred, outcome);
      await sb.update(TABLE, { id: 'eq.' + pred.id }, {
        graded_at: new Date().toISOString(),
        actual_part: outcome.actual_part || null,
        actual_component: outcome.actual_component || null,
        outcome_source: outcome.source || null,
        hit_top1: g.hit_top1,
        hit_top3: g.hit_top3,
        component_hit: g.component_hit,
      });
      graded++;
    }
    return { ok: true, graded };
  } catch (err) {
    console.error('[brain-eval.gradeJob] ' + (err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
}

module.exports = { normalizePart, normalizeComponent, gradeAgainstOutcome, logPrediction, gradeJob, TABLE };
