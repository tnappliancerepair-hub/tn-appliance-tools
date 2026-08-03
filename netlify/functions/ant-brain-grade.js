// ant-brain-grade — closes the learning loop. For each prediction the brain made,
// once the job has a real TDR outcome, compare what we PREDICTED to what actually
// fixed it, and record a hit/miss. That's what makes the accuracy number real
// (and honest — misses count). Run on a schedule or on-demand.
//
//   GET /ant-brain-grade            -> grade all ungraded predictions with an outcome
//   GET /ant-brain-grade?job_id=N   -> grade just one
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const brainEval = require('./_lib/brain-eval');   // forward-eval harness (Supabase, no-op-safe)
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function jfetch(url, opts) { try { const r = await fetch(url, opts); return await r.json(); } catch (_) { return null; } }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const onlyJob = Number(q.job_id) || 0;

  let preds = [], graded = [];
  try {
    preds = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_prediction' }, { id: 'desc' }, 500);
    graded = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_outcome' }, { id: 'desc' }, 500);
  } catch (e) { return ok({ ok: false, error: String(e.message || e) }); }

  const already = new Set((graded || []).map((r) => Number(metaOf(r).job_id)).filter(Boolean));
  // newest prediction per job
  const latest = {};
  for (const r of preds || []) { const m = metaOf(r); const jid = Number(m.job_id); if (!jid) continue; if (!latest[jid]) latest[jid] = m; }

  const results = [];
  for (const jid of Object.keys(latest).map(Number)) {
    if (onlyJob && jid !== onlyJob) continue;
    if (already.has(jid)) continue;                    // grade each job once
    const pred = latest[jid];

    const d = await jfetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jid }) });
    const tdr = (d && d.tdr) || null;
    const actualPart = tdr && (tdr.verified_part_number || '');
    const actualComp = tdr && (tdr.failed_component || '');
    const done = tdr && (/complete|done/i.test(String(tdr.status || '')) || tdr.repair_completed || actualPart);
    if (!tdr || !done || (!actualPart && !actualComp)) continue;   // no real outcome yet → still pending

    // Grade with the shared honest grader: pull the real part# out of a free-text
    // fix, match the guess against ANY part in a multi-part note, and fall to the
    // component tier when there's no part# (a bare "compressor" was being scored a
    // part-miss before). Ungradeable outcomes ("No part needed") record gradeable
    // false so they're not retried and don't count against accuracy.
    const g = brainEval.gradeAgainstOutcome(
      { pred_parts: [pred.part], pred_component: pred.component },
      { actual_part: actualPart, actual_component: actualComp },
    );
    let gradeable, hit, basis;
    if (g.part_gradeable) { gradeable = true; hit = !!g.hit_top1; basis = 'part'; }
    else if (brainEval.normalizeComponent(actualComp)) { gradeable = true; hit = !!g.component_hit; basis = 'component'; }
    else { gradeable = false; hit = false; basis = 'ungradeable'; }

    try { await crud.logEvent('ant_brain_outcome', { job_id: jid, hit, gradeable, basis, predicted_part: pred.part, actual_part: actualPart, predicted_component: pred.component, actual_component: actualComp, confidence: pred.confidence, appliance: pred.appliance || '', at_ms: Date.now() }); } catch (_) {}

    // FORWARD-EVAL: grade the Supabase brain_predictions row(s) for this job with the
    // same actual outcome (top-1 / top-3 / component, leak-proof). No-op-safe if
    // Supabase is unset. This is what fills brain_eval_rollup for the nightly scorecard.
    try { await brainEval.gradeJob(jid, { actual_part: actualPart, actual_component: actualComp, source: 'tdr' }); } catch (_) {}

    results.push({ job_id: jid, hit, basis, predicted: pred.part || pred.component, actual: actualPart || actualComp });
  }

  const hits = results.filter((r) => r.hit).length;
  return ok({ ok: true, graded_now: results.length, hits, misses: results.length - hits, results });
};
