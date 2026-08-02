// ant-brain-predict — the moat. Predict the failed part BEFORE the truck rolls,
// from what has actually fixed similar machines across every job we've seen.
//
// Teddy 2026-07-02: "features aren't the moat — the data is." A copycat with
// ChatGPT can clone a screen; they can't clone our repair history. This is the
// engine that turns that history into a prediction + a confidence number, and
// (via ant-brain-grade / ant-brain-score) tracks whether it was RIGHT so the
// accuracy compounds with every job. Thin today (real TDR flow just started),
// but it only gets smarter — that's the whole point.
//
//   POST { job_id }                              -> predict for an existing job
//   POST { brand, model, appliance_type, symptom } -> ad-hoc predict
//     -> { ok, scope, predictions:[{component, part, part_display, confidence,
//          seen_n}], fault_code?, recommendation, based_on_n }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

let faultCodes = null; try { faultCodes = require('./fault-code-lookup'); } catch (_) {}
const brainEval = require('./_lib/brain-eval');   // forward-eval harness (Supabase, no-op-safe)

async function jfetch(url, opts) { try { const r = await fetch(url, opts); return await r.json(); } catch (_) { return null; } }

// Normalizers so "W11397930 (superseded to W11598119) — Blower" and "w11397930"
// count as the SAME part, and "MOED6027LZ00" matches "moed6027lz00".
function normAlnum(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function partKey(p) {
  const first = String(p || '').trim().split(/[\s(—\-]/)[0];   // leading token before space / "(" / dash
  return normAlnum(first);
}
function normModel(m) { return normAlnum(m); }
function normComp(c) { return String(c || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// Canonical appliance category from any text (an appliance_type field OR a free
// symptom like "bad evaporator motor on a fridge"). Used to HARD-GATE predictions
// so a fridge question can never return an oven/washer part (the cross-appliance
// contamination bug — an oven control board for a fridge evaporator motor).
function canonAppliance(s) {
  const t = String(s || '').toLowerCase();
  if (/(refriger|fridge|freezer|ice ?maker|evapor|condenser|not cooling|won'?t cool|cooling)/.test(t)) return 'refrigerator';
  if (/(dishwash)/.test(t)) return 'dishwasher';
  if (/(\bdryer\b|not drying|won'?t dry|no heat.*dry)/.test(t)) return 'dryer';
  if (/(washer|washing machine|won'?t spin|won'?t drain|won'?t agitate)/.test(t)) return 'washer';
  if (/(\boven\b|\brange\b|stove|cooktop|\bbake\b|broil|burner|not heating)/.test(t)) return 'oven';
  if (/(microwave)/.test(t)) return 'microwave';
  return '';
}

// Does historical model H match query model Q? exact-normalized OR prefix either
// way (handles trailing /A2-01, -01 suffixes).
function modelMatch(h, q) {
  const H = normModel(h), Q = normModel(q);
  if (!H || !Q) return false;
  if (H === Q) return true;
  const min = Math.min(H.length, Q.length);
  return min >= 6 && (H.startsWith(Q) || Q.startsWith(H));
}

// Pull the biggest failure-code we can spot in free text (F5E2, LE, OE, 5E, E24…)
function codeIn(text) {
  const t = String(text || '').toUpperCase();
  const m = t.match(/\b([A-Z]{1,3}\d{1,3}[A-Z]?\d?|\d[A-Z]|[A-Z]{2})\b/g);
  return m && m.length ? m.sort((a, b) => b.length - a.length)[0] : '';
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let inp = {}; try { inp = JSON.parse(event.body || '{}'); } catch (_) {}

  let brand = inp.brand || '', model = inp.model || inp.model_number || '', appliance = inp.appliance_type || inp.appliance || '', symptom = inp.symptom || inp.problem || '';
  const jobId = Number(inp.job_id) || 0;

  if (jobId) {
    const d = await jfetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }) });
    const j = (d && d.job) || {}; const a = (d && d.appliance) || {};
    brand = brand || j.appliance_brand || j.brand || a.brand || '';
    model = model || j.appliance_model || j.model_number || a.model_number || '';
    appliance = appliance || j.appliance_type || a.appliance_type || '';
    symptom = symptom || j.problem_summary || j.problem_description || '';
  }

  // Determine the appliance category to gate on — explicit field, else inferred
  // from the symptom ("evaporator motor on a fridge" -> refrigerator).
  const applQ = canonAppliance(appliance) || canonAppliance(symptom) || canonAppliance(model);
  if (!appliance && applQ) appliance = applQ; // surface the inference back to the caller

  // Pull the whole (small) failure corpus and match client-side, widening scope
  // until we have signal: exact model -> brand+appliance -> appliance. We do NOT
  // fall back to brand-only when the appliance is known — that's what returned an
  // oven board for a fridge. Brand-only is allowed ONLY when appliance is unknown.
  const raw = await jfetch(`${XANO}/get_common_failures?per_page=1000`);
  let all = (raw && raw.entries) || [];

  // HARD APPLIANCE GATE: once we know the appliance, drop any entry where EITHER
  // the appliance_type OR the failed_component text names a DIFFERENT appliance.
  // Checking both catches mislabeled TDRs (appliance_type=Refrigerator but
  // failed_component="oven control board") — the row that leaked an oven part.
  if (applQ) all = all.filter((e) => {
    const eaType = canonAppliance(e.appliance_type);
    const eaComp = canonAppliance(e.failed_component);
    if (eaType && eaType !== applQ) return false;
    if (eaComp && eaComp !== applQ) return false;
    return true;
  });

  const byModel = model ? all.filter((e) => modelMatch(e.model_number, model)) : [];
  const byBrandAppl = (brand && appliance) ? all.filter((e) => normAlnum(e.brand).includes(normAlnum(brand)) && normComp(e.appliance_type).includes(normComp(appliance))) : [];
  const byAppl = appliance ? all.filter((e) => normComp(e.appliance_type).includes(normComp(appliance))) : [];
  const byBrand = brand ? all.filter((e) => normAlnum(e.brand).includes(normAlnum(brand))) : [];

  let matched = byModel, scope = 'exact_model';
  if (matched.length < 2) { matched = byBrandAppl; scope = 'brand+appliance'; }
  if (matched.length < 2) { matched = byAppl; scope = 'appliance'; }
  // brand-only fallback ONLY when we don't know the appliance (else it leaks parts
  // from other appliance categories — the oven-board-for-a-fridge bug).
  if (matched.length < 2 && !applQ && byBrand.length) { matched = byBrand; scope = 'brand'; }
  if (!matched.length) scope = 'none';

  // Aggregate by part (primary key) — count how often each part actually fixed a
  // similar machine. Dedup the double-write rows (same job_id + same part).
  const agg = {}; const seenPairs = new Set();
  for (const e of matched) {
    const pk = partKey(e.verified_part_number);
    if (!pk) continue;
    const pair = (e.job_id || '?') + '|' + pk;
    if (seenPairs.has(pair)) continue;    // ignore the duplicate TDR rows
    seenPairs.add(pair);
    if (!agg[pk]) agg[pk] = { part: pk, part_display: e.verified_part_number, component: e.failed_component || '', n: 0 };
    agg[pk].n += 1;
  }
  const distinctJobs = new Set(matched.map((e) => e.job_id)).size || matched.length;
  const ranked = Object.values(agg).sort((a, b) => b.n - a.n).slice(0, 3).map((p) => ({
    component: p.component, part: p.part, part_display: p.part_display,
    seen_n: p.n, confidence: Math.round((p.n / Math.max(1, distinctJobs)) * 100),
  }));

  // Fault-code layer (if the symptom carries a code).
  let fault = null;
  const code = codeIn(symptom);
  if (code && faultCodes && faultCodes.lookup) { try { const f = faultCodes.lookup(brand, code, appliance); if (f && (f.meaning || f.found)) fault = { code, ...f }; } catch (_) {} }

  const top = ranked[0];
  let recommendation;
  if (top && top.confidence >= 40 && top.seen_n >= 2) recommendation = `Pre-order ${top.part_display || top.part} (${top.component}) — it fixed ${top.seen_n} of the last ${distinctJobs} similar jobs. Roll with the part on the truck.`;
  else if (top) recommendation = `Lean toward ${top.part_display || top.part} (${top.component}), but data is thin (${top.seen_n}/${distinctJobs}). Confirm on site before ordering.`;
  else recommendation = `No matching history yet for this ${appliance || 'machine'}. This job will TEACH the brain — its outcome makes the next prediction smarter.`;

  // Log the prediction so ant-brain-grade can score it against what actually
  // fixed the job. This is the loop that makes accuracy climb.
  if (jobId && top) {
    try { await crud.logEvent('ant_brain_prediction', { job_id: jobId, part: top.part, part_display: top.part_display, component: top.component, confidence: top.confidence, scope, based_on_n: distinctJobs, brand, model, appliance, at_ms: Date.now() }); } catch (_) {}
  }

  // FORWARD-EVAL (the linchpin): mirror the prediction into Supabase brain_predictions
  // BEFORE the job closes — leak-proof by construction; ant-brain-grade back-fills the
  // outcome. Best-effort/no-op-safe: never blocks the brain if Supabase is unset/down.
  // Fires whenever we have a job_id (even with an empty prediction) so COVERAGE is
  // measurable, not just accuracy. Spec: docs/intelligence-architecture.md §Layer 4.
  if (jobId) {
    try {
      await brainEval.logPrediction({
        job_id: jobId,
        context: inp.context || 'pre_diagnosis',
        appliance, brand, model, symptom,
        pred_parts: ranked.map((r) => ({ part: r.part, part_display: r.part_display, component: r.component, confidence: r.confidence })),
        pred_component: top ? top.component : null,
        top_confidence: top ? top.confidence : null,
        grounded: matched.length >= 2,
      });
    } catch (_) {}
  }

  return ok({
    ok: true, job_id: jobId || null, brand, model, appliance, symptom,
    scope, based_on_n: distinctJobs, predictions: ranked,
    fault_code: fault, recommendation,
    note: matched.length < 2 ? 'thin_data_compounds_with_every_job' : undefined,
  });
};
