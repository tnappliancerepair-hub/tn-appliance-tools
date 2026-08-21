// ant-diagnose — the DIAGNOSTIC brain endpoint (Teddy 2026-08-21). Aims at what our
// data can actually answer: WHAT'S FAILING + where to look, from the symptom + model,
// grounded in real repair cause-and-effect (symptom-diagnosis.js) and BOOSTED by the
// shop's own history for that machine. The exact part # is a downstream catalog lookup
// off (model + the top component) — not guessed here.
//
//   POST { job_id }                              -> diagnose an existing job
//   POST { brand, model, appliance, symptom }    -> ad-hoc
//     -> { ok, appliance, matched, note, diagnoses:[{component, confirm, part_category,
//          likelihood, seen_in_history, flags}], safety, where_to_look }
'use strict';

const { diagnose, canonAppliance } = require('./_lib/ant/symptom-diagnosis');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

async function jfetch(url, opts, ms) {
  ms = ms || 6000;
  try { return await Promise.race([fetch(url, opts).then((r) => r.json()), new Promise((res) => setTimeout(() => res(null), ms))]); }
  catch (_) { return null; }
}
// Strip appended call/note noise from a problem_summary before diagnosing.
function cleanSymptom(s) {
  let t = String(s || '');
  t = t.split(/\s*\|\|\s*/)[0];
  t = t.replace(/\[(phone call|call|note|voicemail|vm|sms|text|system)\][\s\S]*$/i, '');
  t = t.replace(/^\s*(other|general|n\/?a|misc(ellaneous)?)\b[:\-\s]*/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'POST only' };
  let inp = {}; try { inp = JSON.parse(event.body || '{}'); } catch (_) {}

  let brand = inp.brand || '', model = inp.model || inp.model_number || '', appliance = inp.appliance || inp.appliance_type || '', symptom = inp.symptom || inp.problem || '';
  const jobId = Number(inp.job_id) || 0;

  if (jobId) {
    const d = await jfetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }) });
    const a = (d && d.appliance) || {}, j = (d && d.job) || {};
    brand = brand || a.brand || j.appliance_brand || '';
    model = model || a.model_number || a.model || j.appliance_model || '';
    appliance = appliance || a.type || a.appliance_type || j.appliance_type || '';
    symptom = symptom || a.problem_summary || a.problem_description || j.problem_summary || '';
  }
  symptom = cleanSymptom(symptom);
  const appl = canonAppliance(appliance) || canonAppliance(symptom);

  // Ground with the shop's history for this brand+appliance: pull the failed_component
  // list so a real recurring failure on this machine boosts its rank. Best-effort.
  let history = [];
  if (appl) {
    const url = `${XANO}/get_common_failures?brand=${encodeURIComponent(brand || '')}&appliance_type=${encodeURIComponent(appl)}&per_page=60`;
    const raw = await jfetch(url);
    const rows = (raw && (raw.entries || raw.items)) || [];
    // prefer same-model rows, else all brand+appliance rows
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const mm = model ? rows.filter((r) => { const H = norm(r.model_number), Q = norm(model); return H && Q && (H === Q || (Math.min(H.length, Q.length) >= 6 && (H.startsWith(Q) || Q.startsWith(H)))); }) : [];
    history = (mm.length ? mm : rows).map((r) => r.failed_component).filter(Boolean);
  }

  const dx = diagnose({ appliance: appl || appliance, brand, model, symptom, history });

  // "Where to look" = the top 1-2 components' confirm tests, phrased for the field.
  const where = (dx.diagnoses || []).slice(0, 2).map((d) => `${d.component}: ${d.confirm}`);

  return ok({
    ok: true, job_id: jobId || null, brand, model, appliance: dx.appliance, symptom,
    matched: dx.matched, note: dx.note,
    diagnoses: dx.diagnoses, circuit: dx.circuit || [], safety: dx.safety,
    grounded_by_history: dx.grounded_by_history, where_to_look: where,
    part_note: 'Exact part # = catalog lookup off (model + the confirmed component). Diagnose first, then pull the SKU.',
  });
};
