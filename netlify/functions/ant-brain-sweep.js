// ant-brain-sweep — auto-fires an Ant Brain prediction on every new job so the
// accuracy loop actually FILLS. Runs on a schedule; catches every job however it
// arrived (warranty email, web chat, quick check). Idempotent: only predicts a
// job that doesn't already have a prediction (or a prior sweep attempt), so it
// never double-logs and never re-chews the same job forever.
//
//   (scheduled)  -> predict up to MAX_PER_RUN fresh recent jobs
//   ?dryrun=1    -> show what it WOULD predict, no writes
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const predict = require('./ant-brain-predict');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

const MAX_PER_RUN = Number(process.env.ANT_BRAIN_SWEEP_MAX) > 0 ? Number(process.env.ANT_BRAIN_SWEEP_MAX) : 8;
const CONCURRENCY = 4;
const MAX_AGE_MS = 72 * 3600 * 1000;   // only recent jobs

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const term = (s) => /cancel|complete|no_fix/i.test(String(s || ''));

async function predictOne(jobId) {
  try {
    const res = await predict.handler({ httpMethod: 'POST', body: JSON.stringify({ job_id: jobId }) });
    const d = JSON.parse(res.body || '{}');
    const top = (d.predictions || [])[0] || null;
    // Mark seen regardless of match, so a no-match job isn't re-chewed every run.
    try { await crud.logEvent('ant_brain_sweep_seen', { job_id: jobId, matched: !!top, at_ms: Date.now() }); } catch (_) {}
    return { job_id: jobId, predicted: !!top, part: top ? top.part : null, confidence: top ? top.confidence : 0 };
  } catch (e) { return { job_id: jobId, error: String(e.message || e) }; }
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dryrun = q.dryrun === '1' || q.dryrun === 'true';

  // 1. recent jobs
  let jobs = [];
  try { const d = await (await fetch(`${XANO}/check_recent_jobs?limit=60`, { signal: AbortSignal.timeout(9000) })).json(); jobs = (d && d.jobs) || []; }
  catch (e) { return ok({ status: 'recent_jobs_failed', error: String(e.message || e) }); }

  // 2. who's already predicted or already swept (skip them)
  let done = new Set();
  try {
    const preds = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_prediction' }, { id: 'desc' }, 500);
    const seen = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_sweep_seen' }, { id: 'desc' }, 500);
    for (const r of [...(preds || []), ...(seen || [])]) { const j = Number(metaOf(r).job_id); if (j) done.add(j); }
  } catch (_) { /* fail-open: worst case a dup prediction, harmless */ }

  // 3. candidates: recent, non-terminal, has an appliance, not already done
  const now = Date.now();
  const cands = jobs.filter((j) => {
    const jid = Number(j.id); if (!jid || done.has(jid)) return false;
    if (term(j.current_status) || term(j.scheduling_status)) return false;
    if (!String(j.appliance_type || '').trim()) return false;         // need something to predict on
    const created = new Date(j.created_at || 0).getTime();
    if (created && (now - created) > MAX_AGE_MS) return false;
    return true;
  }).slice(0, MAX_PER_RUN);

  if (dryrun) return ok({ status: 'dryrun', recent: jobs.length, already_done: done.size, would_predict: cands.map((j) => ({ job_id: j.id, appliance: j.appliance_type })) });

  // 4. predict (bounded concurrency)
  const results = [];
  for (let i = 0; i < cands.length; i += CONCURRENCY) {
    const batch = cands.slice(i, i + CONCURRENCY).map((j) => predictOne(Number(j.id)));
    results.push(...await Promise.all(batch));
  }
  const predicted = results.filter((r) => r.predicted).length;
  return ok({ status: 'ran', recent: jobs.length, already_done: done.size, attempted: results.length, predicted, results });
};
