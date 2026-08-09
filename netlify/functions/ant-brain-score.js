// ant-brain-score — the number Teddy watches climb. Live diagnostic accuracy:
// of the predictions the brain made, how often was it RIGHT about the part/component
// that actually fixed the job. Overall + by appliance + recent examples.
//
//   GET /ant-brain-score            -> live accuracy
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const brainEval = require('./_lib/brain-eval');   // shared honest grader (single source of truth)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(r) { return Number(metaOf(r).at_ms) || Date.parse(r && r.created_at) || 0; }

// Re-grade a stored outcome row from its RAW predicted/actual text using the shared
// grader — so the headline number is honest even for rows written by the old logic
// (which took the first WORD of a free-text note as the "part" → guaranteed miss).
// Ungradeable outcomes (no part# AND no component to check) leave the denominator.
function regrade(r) {
  const g = brainEval.gradeAgainstOutcome(
    { pred_parts: [r.predicted_part], pred_component: r.predicted_component },
    { actual_part: r.actual_part, actual_component: r.actual_component },
  );
  const bothComp = !!brainEval.normalizeComponent(r.predicted_component) && !!brainEval.normalizeComponent(r.actual_component);
  // Base hit = exact part (top-1) when there's a part to grade, else right component.
  let gradeable = false, hit = false, basis = 'ungradeable';
  if (g.part_gradeable) { gradeable = true; hit = !!g.hit_top1; basis = 'part'; }
  else if (brainEval.normalizeComponent(r.actual_component)) { gradeable = true; hit = !!g.component_hit; basis = 'component'; }
  // "Useful" = the brain pointed the tech right: exact part OR the right failed
  // component (a right-component/wrong-SKU guess still saves the trip). Honest and
  // fairer than exact-SKU-only — a Whirlpool W11400156 vs W11614514 near-miss still
  // named the right part family.
  const useful = gradeable && (hit || !!g.component_hit);
  return { gradeable, hit, basis, part_gradeable: !!g.part_gradeable, component_hit: !!g.component_hit, both_comp: bothComp, useful };
}

exports.handler = async function () {
  let outcomes = [], preds = [];
  try {
    outcomes = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_outcome' }, { id: 'desc' }, 500);
    preds = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_prediction' }, { id: 'desc' }, 500);
  } catch (e) { return ok({ ok: false, error: String(e.message || e) }); }

  const allRows = (outcomes || []).map(metaOf).map((r) => ({ ...r, ...regrade(r) }));
  const rows = allRows.filter((r) => r.gradeable);           // only outcomes we can fairly grade
  const ungradeable = allRows.length - rows.length;
  const total = rows.length;
  const hits = rows.filter((r) => r.hit).length;
  const acc = total ? Math.round((hits / total) * 100) : 0;

  // Fairer breakdown (honest scoreboard): exact-part top-1, right-component, and a
  // combined "useful" number. Exact part is the strict headline; component shows the
  // brain often knows WHAT failed even when the exact SKU differs; useful = either.
  const partRows = rows.filter((r) => r.part_gradeable);
  const partHits = partRows.filter((r) => r.hit).length;
  const partAcc = partRows.length ? Math.round((partHits / partRows.length) * 100) : 0;
  const compRows = rows.filter((r) => r.both_comp);
  const compHits = compRows.filter((r) => r.component_hit).length;
  const compAcc = compRows.length ? Math.round((compHits / compRows.length) * 100) : 0;
  const usefulHits = rows.filter((r) => r.useful).length;
  const usefulAcc = total ? Math.round((usefulHits / total) * 100) : 0;

  // by appliance
  const byAppl = {};
  for (const r of rows) { const a = (r.appliance || 'other').toLowerCase(); if (!byAppl[a]) byAppl[a] = { n: 0, hit: 0 }; byAppl[a].n++; if (r.hit) byAppl[a].hit++; }
  const byAppliance = Object.entries(byAppl).map(([a, v]) => ({ appliance: a, graded: v.n, accuracy: Math.round((v.hit / v.n) * 100) })).sort((x, y) => y.graded - x.graded);

  // last-20 accuracy (trend)
  const last20 = rows.slice(0, 20);
  const acc20 = last20.length ? Math.round((last20.filter((r) => r.hit).length / last20.length) * 100) : 0;

  const distinctPredJobs = new Set((preds || []).map((r) => Number(metaOf(r).job_id)).filter(Boolean)).size;
  const outcomeJobs = new Set(allRows.map((r) => Number(r.job_id)).filter(Boolean)).size;

  return ok({
    ok: true,
    accuracy_pct: acc, graded_total: total, hits, misses: total - hits,
    // honest breakdown
    part_accuracy_pct: partAcc, part_graded: partRows.length,        // exact SKU, top-1 (the strict number)
    component_accuracy_pct: compAcc, component_graded: compRows.length, // right failed component (any SKU)
    useful_accuracy_pct: usefulAcc,                                   // exact part OR right component
    ungradeable,   // outcomes with no part# to grade against (excluded, not counted as misses)
    accuracy_last20: acc20,
    predictions_made: distinctPredJobs, pending_grade: Math.max(0, distinctPredJobs - outcomeJobs),
    by_appliance: byAppliance,
    recent: rows.slice(0, 12).map((r) => ({ job_id: r.job_id, hit: r.hit, basis: r.basis, predicted: r.predicted_part || r.predicted_component, actual: r.actual_part || r.actual_component, appliance: r.appliance, when: tsOf({ metadata: r }) })),
  });
};
