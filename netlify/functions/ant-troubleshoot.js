// ant-troubleshoot — the grounded troubleshooting brain. Fuses THREE sources for
// a model+symptom and has Claude compose a cited diagnostic brief:
//   1. Fault-code DB (publicly-documented codes)         [fault-code]
//   2. This shop's common failures for the model (TDRs)  [common-failures]
//   3. Semantically similar past jobs (TDR vector store)  [job #N]
// Grounded-only: Claude is told to use the provided context and cite it; if the
// context is thin it must say so rather than guess. Part numbers defer to the
// live parts lookup + TDR history — never invented.
//
//   POST { brand, model, appliance, symptom, code?, job_id?, role? }
//   -> { ok, grounded, answer_md, fault_code, common_failures, similar_jobs, citations }
//
// role: 'tech'|'office'|'owner' (full) | 'customer' (sanitized — no part #s / internal cost)

'use strict';
const { runBrainTurn } = require('./_lib/ant/brain-core');
const faultCodes = require('./fault-code-lookup');

const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const FUNCTIONS_BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 200); }

// Pull a code-looking token out of free text ("getting a 4C", "F5 E2", "OE error")
function detectCode(text) {
  const m = String(text || '').toUpperCase().match(/\b([A-Z]{1,2}\d{0,2}\s?E?\d{0,2}|\d[CE]|[A-Z]{2})\b/g);
  if (!m) return '';
  // prefer tokens that contain a digit or are 2-letter codes like OE/LE/IE/UE/DE
  const cand = m.find((t) => /\d/.test(t)) || m.find((t) => /^(OE|LE|IE|UE|DE|FE|TE|PE|AE|HC|DC|LC|SD|UL|AF|PF)$/.test(t.replace(/\s/g, '')));
  return cand ? cand.replace(/\s/g, '') : '';
}

async function getCommonFailures(brand, appliance, model) {
  try {
    const url = `${XANO_INTAKE}/get_common_failures?brand=${encodeURIComponent(brand)}&appliance_type=${encodeURIComponent(appliance)}&model_number=${encodeURIComponent(model)}&per_page=8`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const d = await r.json();
    return (d && d.entries) || [];
  } catch (_) { return []; }
}

async function getSimilarJobs(query, jobId) {
  try {
    const r = await fetch(`${FUNCTIONS_BASE}/ask-ant-semantic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, namespace: 'tdr', top_k: 5 }),
    });
    const d = await r.json();
    let rows = (d && d.results) || [];
    if (jobId) rows = rows.filter((x) => Number(x.source_row_id) !== Number(jobId));
    return rows.slice(0, 4);
  } catch (_) { return []; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const brand = s(b.brand, 40);
  const model = s(b.model, 60);
  const appliance = s(b.appliance, 40);
  const symptom = s(b.symptom, 600);
  const role = (s(b.role, 12) || 'tech').toLowerCase();
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  const code = s(b.code, 16) || detectCode(symptom);

  if (!brand && !model && !symptom) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'brand/model/symptom required' }) };
  }

  // ── gather context (parallel) ──────────────────────────────────────────────
  const fcRes = code ? faultCodes.lookup(brand, code, appliance) : { match: null };
  const [commonFailures, similarJobs] = await Promise.all([
    getCommonFailures(brand, appliance, model),
    getSimilarJobs([brand, appliance, model, symptom].filter(Boolean).join(' '), jobId),
  ]);

  const faultMatch = fcRes.match || null;
  const grounded = !!(faultMatch || commonFailures.length || similarJobs.length);

  // ── build the grounded context block for Claude ─────────────────────────────
  const ctxParts = [];
  if (faultMatch) {
    ctxParts.push(`[fault-code] ${brand} ${faultMatch.appliance} code ${faultMatch.code}: ${faultMatch.meaning}. Likely causes: ${(faultMatch.likely_causes || []).join(', ')}. Confirming test: ${faultMatch.test}`);
  }
  if (commonFailures.length) {
    ctxParts.push('[common-failures] This shop\'s past TDRs for similar units:\n' + commonFailures.map((e) =>
      `- ${e.brand || ''} ${e.appliance_type || ''} ${e.model_number || ''}: failed=${e.failed_component || '?'} cause=${e.failure_cause || '?'}${e.verified_part_number ? ' part=' + e.verified_part_number : ''} (job #${e.job_id || '?'})`
    ).join('\n'));
  }
  if (similarJobs.length) {
    ctxParts.push('[similar-jobs] Semantically similar past jobs:\n' + similarJobs.map((x) =>
      `- job #${x.source_row_id} (match ${(x.score != null ? (x.score * 100).toFixed(0) : '?')}%): ${s(x.preview, 240)}`
    ).join('\n'));
  }
  const contextBlock = ctxParts.length ? ctxParts.join('\n\n') : '(no grounding context found for this model/symptom)';

  const isCustomer = role === 'customer';
  const systemPrompt = [
    'You are Ant, a grounded appliance-repair diagnostician for TN Appliance Exchange.',
    'Answer ONLY from the CONTEXT provided (fault-code DB, this shop\'s past jobs, common failures).',
    'Cite every claim inline with the bracket tag it came from: [fault-code], [common-failures], or [job #N].',
    'If the context is thin or empty, SAY SO plainly and give the best general next diagnostic step — do not fabricate specifics.',
    'NEVER invent a part number. If a part is implicated, name the component and say "confirm exact part via the parts lookup". Real part numbers come from the live Marcone/Amazon lookup + the cited TDRs only.',
    isCustomer
      ? 'AUDIENCE = CUSTOMER: plain language, reassuring, NO part numbers, NO internal costs, NO repair instructions that could cause injury. Frame as "here is what is likely going on and what the tech will check."'
      : 'AUDIENCE = TECH: tight, tech-to-tech. Rank the 2-3 likely causes, give the confirming test for each, and the likely component. Lead with the fastest check.',
    'Format: short markdown. Start with a one-line headline, then a ranked list. Keep it under ~180 words.',
  ].join(' ');

  const userContent =
    `UNIT: ${[brand, appliance, model].filter(Boolean).join(' ') || 'unknown'}\n` +
    (code ? `REPORTED CODE: ${code}\n` : '') +
    `SYMPTOM: ${symptom || '(none given)'}\n\n` +
    `CONTEXT:\n${contextBlock}\n\n` +
    `Give the grounded diagnosis now${isCustomer ? ' for the customer' : ' for the tech'}.`;

  let answer = '';
  try {
    const turn = await runBrainTurn({
      systemPrompt,
      userContent,
      maxTokens: 700,
      ctx: { critical: false, source: 'ant_troubleshoot' },
    });
    answer = (turn && turn.reply) || '';
    if (turn && turn.error && !answer) answer = '';
  } catch (e) {
    answer = '';
  }

  // citations the UI can render as chips
  const citations = [];
  if (faultMatch) citations.push({ type: 'fault-code', label: `${brand} ${faultMatch.code}` });
  for (const e of commonFailures) if (e.job_id) citations.push({ type: 'job', label: `job #${e.job_id}`, job_id: e.job_id });
  for (const x of similarJobs) citations.push({ type: 'job', label: `job #${x.source_row_id}`, job_id: x.source_row_id });

  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({
      ok: true,
      grounded,
      answer_md: answer,
      fault_code: faultMatch,
      common_failures: commonFailures,
      similar_jobs: similarJobs,
      citations,
      code: code || null,
      role,
    }),
  };
};
