// brain-recall — the reliable answer: count-and-rank over the four-field knowledge rows.
// Reliability lever #3. A single captured row says "this part solved this job." The
// RELIABLE answer aggregates every closed job for a model-family + normalized symptom and
// ranks parts by how often they SOLVED it minus how often they DID-NOT — so the brain gives
// "compressor solved 8/10, start relay did-not 6/10", not a lone guess. Read-only.
//
//   GET ?model=WTW5000DW1&symptom=won't%20drain[&appliance=washer]
//   GET ?job_id=12345                       (resolves model+symptom from the job)
//   -> { ok, model, canon_symptom, sample_size, ranked:[{part, solved, did_not, net, confidence}] }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { canonSymptom } = require('./_lib/ant/symptom-canon');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function familyMatch(a, b) { a = norm(a); b = norm(b); if (!a || !b) return false; if (a === b) return true; const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 6 && l.startsWith(s); }
async function jfetch(url, opts) { try { const r = await fetch(url, { ...(opts || {}), signal: AbortSignal.timeout(6000) }); return await r.json(); } catch (_) { return null; } }

exports.config = { timeout: 20 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = (event && event.queryStringParameters) || {};
  let model = q.model || '', symptomText = q.symptom || '', appliance = q.appliance || '';

  // job_id path: resolve model + symptom + appliance from the live job.
  if (q.job_id && (!model || !symptomText)) {
    const d = await jfetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: Number(q.job_id) }) });
    const a = (d && d.appliance) || {};
    model = model || a.model_number || a.model || '';
    appliance = appliance || a.type || a.appliance_type || '';
    symptomText = symptomText || a.problem_summary || '';
  }
  if (!model) return json(400, { ok: false, error: 'need ?model= (or ?job_id=)' });
  const canon = canonSymptom(appliance, symptomText);

  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_captured' }, { id: 'desc' }, 800); } catch (e) { return json(200, { ok: false, error: 'read failed' }); }

  // Aggregate: for every captured job on this model-family (and matching normalized symptom
  // when we have one), tally each part's solved vs did-not-solve.
  const tally = new Map();     // partNorm -> { part, solved, did_not }
  let sample = 0;
  const wantSymptom = canon && canon !== 'unknown';
  for (const r of rows) {
    const m = metaOf(r);
    if (!familyMatch(m.model, model)) continue;
    if (wantSymptom && m.canon_symptom && m.canon_symptom !== canon) continue;   // symptom filter (skip only when the row HAS a canon and it differs)
    sample++;
    const solved = Array.isArray(m.solved_parts) ? m.solved_parts : (m.solved_part ? [m.solved_part] : []);
    const didnot = Array.isArray(m.did_not_solve_parts) ? m.did_not_solve_parts : [];
    for (const p of solved) { const k = norm(p); if (!k) continue; const e = tally.get(k) || { part: p, solved: 0, did_not: 0 }; e.solved++; e.part = e.part || p; tally.set(k, e); }
    for (const p of didnot) { const k = norm(p); if (!k) continue; const e = tally.get(k) || { part: p, solved: 0, did_not: 0 }; e.did_not++; e.part = e.part || p; tally.set(k, e); }
  }

  const ranked = [...tally.values()]
    .map((e) => { const total = e.solved + e.did_not; return { ...e, net: e.solved - e.did_not, confidence: total ? Math.round((e.solved / total) * 100) : 0 }; })
    .sort((a, b) => b.net - a.net || b.solved - a.solved)
    .slice(0, 12);

  return json(200, {
    ok: true, model, appliance, canon_symptom: canon, sample_size: sample,
    grounded: sample > 0,
    ranked,
    note: sample === 0 ? 'no closed jobs for this model+symptom yet — the flywheel fills this as jobs close' : undefined,
  });
};
