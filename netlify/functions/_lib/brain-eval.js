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

// Pull candidate part-number tokens out of a free-text outcome. Real fixes get
// logged as messy notes — "Range Oven Door Outer Panel (White) WPW10118454",
// "Ccuasm, Vmax Part #W11101488, Actuator Part #W10815026" — the actual part# is
// in there, it just isn't clean. Grab every part-number-shaped token (has a digit,
// 5-24 chars; dashes/slashes are internal to a part# so they're kept, spaces split)
// so a RIGHT guess isn't scored a miss because the tech typed a sentence. When this
// returns [] the outcome has no part# to grade against ("No part needed", a bare
// component like "compressor") → the prediction is UNGRADEABLE for the part tier,
// NOT a miss (that's what was quietly tanking the accuracy number).
const PART_TOKEN_RE = /[A-Z0-9]+(?:[-/][A-Z0-9]+)*/g;
function extractPartTokens(text) {
  const out = [];
  const seen = new Set();
  const m = String(text == null ? '' : text).toUpperCase().match(PART_TOKEN_RE) || [];
  for (const tok of m) {
    const norm = tok.replace(/[^A-Z0-9]/g, '');
    if (norm.length < 5 || norm.length > 24) continue;   // part#s are ~5-15
    if (!/[0-9]/.test(norm)) continue;                   // must contain a digit
    if (!/[A-Z]/.test(norm) && norm.length < 6) continue; // a short bare number = noise
    if (seen.has(norm)) continue;
    seen.add(norm); out.push(norm);
  }
  return out;
}

// Grade a stored prediction against the actual fix. Pure — unit-tested, no I/O.
//   pred.pred_parts = [{part, confidence}, ...] ranked (strings also accepted)
//   outcome = { actual_part, actual_component }
// Returns hit_top1/hit_top3 as booleans when the outcome HAS a part# to grade
// against, or `null` when it doesn't (part_gradeable=false) so the scorer can drop
// ungradeable rows from the denominator instead of counting them as misses.
function gradeAgainstOutcome(pred, outcome) {
  const parts = Array.isArray(pred && pred.pred_parts) ? pred.pred_parts : [];
  const ranked = parts
    .map((x) => normalizePart(x && typeof x === 'object' ? (x.part ?? x.part_number ?? '') : x))
    .filter(Boolean);

  const actualTokens = extractPartTokens(outcome && outcome.actual_part);   // real part#s in the note
  const actualBlob = normalizePart(outcome && outcome.actual_part);          // whole thing collapsed
  const part_gradeable = actualTokens.length > 0;

  // A predicted part matches if it's one of the actual tokens, or (for a solid
  // 6+ char part#) appears inside the collapsed blob — catches space-split forms.
  const matches = (p) => !!p && (actualTokens.includes(p) || (p.length >= 6 && actualBlob.includes(p)));

  let hit_top1 = null;
  let hit_top3 = null;
  if (part_gradeable) {
    hit_top1 = ranked.length > 0 && matches(ranked[0]);
    hit_top3 = ranked.slice(0, 3).some(matches);
  }

  const pc = normalizeComponent(pred && pred.pred_component);
  const ac = normalizeComponent(outcome && outcome.actual_component);
  const component_hit = !!ac && !!pc && (pc === ac || pc.includes(ac) || ac.includes(pc));

  return { hit_top1, hit_top3, component_hit, part_gradeable };
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

module.exports = { normalizePart, normalizeComponent, extractPartTokens, gradeAgainstOutcome, logPrediction, gradeJob, TABLE };
