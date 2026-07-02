// ant-brain-score — the number Teddy watches climb. Live diagnostic accuracy:
// of the predictions the brain made, how often was it RIGHT about the part/component
// that actually fixed the job. Overall + by appliance + recent examples.
//
//   GET /ant-brain-score            -> live accuracy
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(r) { return Number(metaOf(r).at_ms) || Date.parse(r && r.created_at) || 0; }

exports.handler = async function () {
  let outcomes = [], preds = [];
  try {
    outcomes = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_outcome' }, { id: 'desc' }, 500);
    preds = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_prediction' }, { id: 'desc' }, 500);
  } catch (e) { return ok({ ok: false, error: String(e.message || e) }); }

  const rows = (outcomes || []).map(metaOf);
  const total = rows.length;
  const hits = rows.filter((r) => r.hit).length;
  const acc = total ? Math.round((hits / total) * 100) : 0;

  // by appliance
  const byAppl = {};
  for (const r of rows) { const a = (r.appliance || 'other').toLowerCase(); if (!byAppl[a]) byAppl[a] = { n: 0, hit: 0 }; byAppl[a].n++; if (r.hit) byAppl[a].hit++; }
  const byAppliance = Object.entries(byAppl).map(([a, v]) => ({ appliance: a, graded: v.n, accuracy: Math.round((v.hit / v.n) * 100) })).sort((x, y) => y.graded - x.graded);

  // last-20 accuracy (trend)
  const last20 = rows.slice(0, 20);
  const acc20 = last20.length ? Math.round((last20.filter((r) => r.hit).length / last20.length) * 100) : 0;

  const distinctPredJobs = new Set((preds || []).map((r) => Number(metaOf(r).job_id)).filter(Boolean)).size;

  return ok({
    ok: true,
    accuracy_pct: acc, graded_total: total, hits, misses: total - hits,
    accuracy_last20: acc20,
    predictions_made: distinctPredJobs, pending_grade: Math.max(0, distinctPredJobs - total),
    by_appliance: byAppliance,
    recent: rows.slice(0, 12).map((r) => ({ job_id: r.job_id, hit: r.hit, predicted: r.predicted_part || r.predicted_component, actual: r.actual_part || r.actual_component, appliance: r.appliance, when: tsOf({ metadata: r }) })),
  });
};
