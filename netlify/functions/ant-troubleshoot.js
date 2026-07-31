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
const playbook = require('./_lib/ant/playbook-lookup');
const modelIntel = require('./get-model-intel');
const modelKnowledge = require('./_lib/ant/model-knowledge');
const crud = require('./_lib/xano/metadata-crud');

const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const FUNCTIONS_BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 200); }

// Live MSA/Whirlpool intel straight off the Mac daemon via the fast tunnel
// (parts-lookup-direct, path=intel). Returns {recalls, bulletins, tech_sheets}
// or null if the tunnel/daemon is unavailable (caller falls back to the cache).
async function liveModelIntel(brand, model) {
  try {
    const u = `${FUNCTIONS_BASE}/parts-lookup-direct?path=intel&source=msa&brand=${encodeURIComponent(brand || '')}&model=${encodeURIComponent(model || '')}`;
    const r = await fetch(u);
    const d = await r.json().catch(() => null);
    const data = (d && d.ok && d.data) ? d.data : null;
    if (!data) return null;
    return { recalls: data.recalls || [], bulletins: data.bulletins || [], tech_sheets: data.tech_sheets || [], source: data.source, final_url: data.final_url, live: true };
  } catch (_) { return null; }
}

// Pull a code-looking token out of free text ("getting a 4C", "F5 E2", "OE error")
function detectCode(text) {
  const m = String(text || '').toUpperCase().match(/\b([A-Z]{1,2}\d{0,2}\s?E?\d{0,2}|\d[CE]|[A-Z]{2})\b/g);
  if (!m) return '';
  // prefer tokens that contain a digit or are 2-letter codes like OE/LE/IE/UE/DE
  const cand = m.find((t) => /\d/.test(t)) || m.find((t) => /^(OE|LE|IE|UE|DE|FE|TE|PE|AE|HC|DC|LC|SD|UL|AF|PF)$/.test(t.replace(/\s/g, '')));
  return cand ? cand.replace(/\s/g, '') : '';
}

// Pull the brand+appliance POOL of past TDR failures (NOT model-filtered — Xano's
// model filter is exact-match and returns 0 on a real SKU like WTW5000DW1). The
// pool is what model-knowledge family-matches against (WTW5000DW1 -> WTW5000DW*),
// and it also feeds the broader [common-failures] context block.
async function getCommonFailures(brand, appliance) {
  try {
    const url = `${XANO_INTAKE}/get_common_failures?brand=${encodeURIComponent(brand)}&appliance_type=${encodeURIComponent(appliance)}&per_page=60`;
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

// The 24k-job HCP archive — real history for this machine (model first, then
// brand+appliance). Job notes carry complaints + sometimes the part delivered.
async function getArchiveHistory(brand, model, appliance) {
  try {
    const u = `${FUNCTIONS_BASE}/hcp-recall?model=${encodeURIComponent(model || '')}&brand=${encodeURIComponent(brand || '')}&appliance=${encodeURIComponent(appliance || '')}&limit=5`;
    const d = await fetch(u).then((r) => r.json());
    return (d && d.ok && d.jobs) ? { matched_on: d.matched_on, jobs: d.jobs } : { jobs: [] };
  } catch (_) { return { jobs: [] }; }
}

// Keep grounding ON the appliance. The semantic store returns the most similar
// TDRs regardless of appliance, so a washer symptom ("loud, won't spin") can pull
// back a FRIDGE job that mentions "compressor" — which is how Ant started telling
// Lee his washer had a compressor. A washer/dryer/dishwasher/oven has no
// compressor, refrigerant, sealed system, or evaporator, so drop any retrieved
// job that reads like a refrigeration job when the unit isn't refrigeration.
const REFRIG_RE = /\b(compressor|refrigerant|freon|sealed[ -]?system|evaporator|condenser coil|defrost|ice[ -]?maker|freezer|fridge|refrigerat)/i;
function isRefrigeration(appl) { return /fridge|refriger|freezer|\bice\b|cooler|wine/i.test(String(appl || '')); }
function dropForeignAppliance(rows, appliance) {
  const a = String(appliance || '').trim();
  if (!a || isRefrigeration(a)) return rows; // unknown or actually a fridge → keep
  return (rows || []).filter((x) => !REFRIG_RE.test(String((x && (x.preview || x.text || x.failed_component)) || '')));
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
  let [commonPool, similarJobs, intelHit, archive] = await Promise.all([
    getCommonFailures(brand, appliance),
    getSimilarJobs([brand, appliance, model, symptom].filter(Boolean).join(' '), jobId),
    (model || brand) ? modelIntel.readModelIntel({ brand, model }).catch(() => null) : Promise.resolve(null),
    (model || brand) ? getArchiveHistory(brand, model, appliance) : Promise.resolve({ jobs: [] }),
  ]);
  const archiveJobs = (archive && archive.jobs) || [];
  // Strip cross-appliance grounding so a fridge TDR never bleeds into a washer
  // (or vice-versa handled by the appliance check inside).
  similarJobs = dropForeignAppliance(similarJobs, appliance);
  let commonFailures = dropForeignAppliance(commonPool, appliance).slice(0, 8);

  // ── ANCHOR: model-specific recall. "On THIS exact model / platform family, here
  // is what fails + the part." Pure, reliable, family-matched over the pool + the
  // bundled base. This is the highest-trust structured source after the playbook.
  const modelRecall = model ? modelKnowledge.recall({ brand, appliance, model, entries: commonPool }) : { matched_on: null, failures: [] };
  const hasModelRecall = !!(modelRecall.failures && modelRecall.failures.length);

  const faultMatch = fcRes.match || null;
  // Owner-curated playbook (repair-playbook.json) — matched on the customer's own
  // words. Highest-trust source; the brain is told to LEAD with it when present.
  const pbMatches = playbook.match({ brand, appliance, symptom }, 3);
  let intel = intelHit ? intelHit.md : null;

  // Cache miss + we have a model: pull LIVE off the daemon via the fast tunnel
  // (parts-lookup-direct, path=intel) so the FIRST troubleshooting already has
  // MSA recalls/bulletins/tech-sheets — not just the next one. Silent fallback if
  // the tunnel is down. Either way, warm the cache for next time.
  if (!intel && model) {
    const live = await liveModelIntel(brand, model);
    if (live && ((live.recalls && live.recalls.length) || (live.bulletins && live.bulletins.length) || (live.tech_sheets && live.tech_sheets.length))) {
      intel = live;
    }
    fetch(`${FUNCTIONS_BASE}/request-model-intel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, model, appliance }),
    }).catch(() => {});
  }

  const recalls = (intel && intel.recalls) || [];
  const bulletins = (intel && intel.bulletins) || [];

  const grounded = !!(hasModelRecall || pbMatches.length || faultMatch || commonFailures.length || similarJobs.length || recalls.length || bulletins.length || archiveJobs.length);

  // ── build the grounded context block for Claude ─────────────────────────────
  const ctxParts = [];
  if (pbMatches.length) {
    const isCust = role === 'customer';
    const lines = pbMatches.map((m) => {
      const e = m.entry; const sym = m.matched.join(' / ');
      if (isCust) return `- "${sym}" is usually ${e.likely_cause}. What the tech does: ${e.fix}`;
      const flags = [e.easy ? 'easy/affordable' : '', e.smarthq ? 'GE SmartHQ readable' : ''].filter(Boolean).join(', ');
      return `- ${e.brand} ${e.appliance}${e.config ? ' (' + e.config + ')' : ''} — "${sym}": ${e.likely_cause}. Fix: ${e.fix}${flags ? ' [' + flags + ']' : ''}${e.note ? ' NOTE: ' + e.note : ''}`;
    });
    ctxParts.push("[playbook] TN Appliance owner's proven fixes for this exact symptom — LEAD WITH THIS, it's our most-trusted source:\n" + lines.join('\n'));
  }
  if (hasModelRecall) {
    const tierLabel = modelRecall.matched_on === 'model' ? 'this EXACT model' : modelRecall.matched_on === 'family' ? `this platform family (${modelRecall.family}*)` : modelRecall.matched_on === 'platform' ? 'this platform line' : 'the trade record for this model';
    const isCust = role === 'customer';
    const lines = modelRecall.failures.map((f) => {
      const src = f.base ? 'trade pattern' : `${f.count} job${f.count === 1 ? '' : 's'}`;
      if (isCust) return `- ${f.component}${f.cause ? ' (' + f.cause + ')' : ''}`;
      return `- ${f.component}${f.cause ? ' — ' + f.cause : ''}${f.part ? ' → part ' + f.part : ''} [${src}${f.jobs && f.jobs.length ? ', job #' + f.jobs[0] : ''}]`;
    });
    ctxParts.push(`[model-history] What actually fails on ${tierLabel} — our verified record, ranked by how often. LEAD WITH THIS for a model-specific answer; the top item is the first thing to check and the part to pre-order:\n` + lines.join('\n'));
  }
  if (recalls.length || bulletins.length) {
    const lines = [];
    for (const r of recalls.slice(0, 6)) lines.push('RECALL: ' + (typeof r === 'string' ? r : r.text));
    for (const b of bulletins.slice(0, 6)) lines.push('BULLETIN/TSB: ' + (typeof b === 'string' ? b : b.text));
    ctxParts.push('[recall] MSA World / manufacturer notices for this model — LEAD WITH THESE if relevant:\n' + lines.join('\n'));
  }
  if (faultMatch) {
    ctxParts.push(`[fault-code] ${brand} ${faultMatch.appliance} code ${faultMatch.code}: ${faultMatch.meaning}. Likely causes: ${(faultMatch.likely_causes || []).join(', ')}. Confirming test: ${faultMatch.test}`);
  }
  if (commonFailures.length) {
    ctxParts.push('[common-failures] This shop\'s past TDRs for similar units:\n' + commonFailures.map((e) =>
      `- ${e.brand || ''} ${e.appliance_type || ''} ${e.model_number || ''}: failed=${e.failed_component || '?'} cause=${e.failure_cause || '?'}${e.verified_part_number ? ' part=' + e.verified_part_number : ''} (job #${e.job_id || '?'})`
    ).join('\n'));
  }
  if (archiveJobs.length) {
    ctxParts.push('[archive] Real history for this machine from our 24k-job archive — notes carry the complaint + sometimes the part we used (extract a part number if one is clearly stated, else treat as pattern evidence):\n' + archiveJobs.map((x) =>
      `- ${String(x.snippet || '').replace(/\s+/g, ' ').slice(0, 200)}`
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
    `THE UNIT IS A ${(appliance || 'appliance').toUpperCase()}. Stay strictly within THIS appliance. A washer, dryer, dishwasher, oven, range, or microwave has NO compressor, refrigerant, sealed system, condenser, or evaporator — NEVER name those for a non-refrigeration appliance. If any CONTEXT item is clearly a different appliance, IGNORE it and say the grounding is thin rather than forcing a wrong-appliance part.`,
    'Answer ONLY from the CONTEXT provided (owner playbook, fault-code DB, this shop\'s past jobs, common failures).',
    'When [playbook] is present, LEAD WITH IT — it is the shop owner\'s proven diagnosis for this exact symptom; trust it above the other sources.',
    'When [model-history] is present, it is our verified record of what actually fails on THIS exact model/platform — lead your ranked causes with it and name the part to pre-order from its top item. It outranks generic [common-failures] because it is model-specific.',
    'Cite every claim inline with the bracket tag it came from: [playbook], [model-history], [fault-code], [common-failures], or [job #N].',
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

  // ── Knowledge Engine: record what we could NOT confidently answer, so the daily
  // loop fills it and it never recurs. A fault code with no DB match, or a
  // model/symptom with zero grounding, is a gap worth closing. Best-effort only.
  try {
    const g = { brand, appliance, code, model, symptom, role, at_ms: Date.now() };
    if (code && !faultMatch) { g.kind = 'fault_code'; await crud.logEvent('knowledge_gap', g); }
    else if (!grounded && (model || symptom)) { g.kind = 'model'; await crud.logEvent('knowledge_gap', g); }
  } catch (_) {}

  // citations the UI can render as chips
  const citations = [];
  if (pbMatches.length) citations.push({ type: 'playbook', label: 'shop playbook' });
  if (hasModelRecall) citations.push({ type: 'model-history', label: modelRecall.matched_on === 'model' ? `${model} record` : `${modelRecall.family}* record`, matched_on: modelRecall.matched_on });
  if (recalls.length) citations.push({ type: 'recall', label: 'recall' });
  if (bulletins.length) citations.push({ type: 'bulletin', label: 'bulletin/TSB' });
  if (faultMatch) citations.push({ type: 'fault-code', label: `${brand} ${faultMatch.code}` });
  for (const e of commonFailures) if (e.job_id) citations.push({ type: 'job', label: `job #${e.job_id}`, job_id: e.job_id });
  for (const x of similarJobs) citations.push({ type: 'job', label: `job #${x.source_row_id}`, job_id: x.source_row_id });
  if (archiveJobs.length) citations.push({ type: 'archive', label: `archive · ${archiveJobs.length} past ${archiveJobs.length === 1 ? 'job' : 'jobs'}` });

  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({
      ok: true,
      grounded,
      answer_md: answer,
      model_recall: hasModelRecall ? { matched_on: modelRecall.matched_on, family: modelRecall.family, seen_n: modelRecall.seen_n, failures: modelRecall.failures } : null,
      playbook_matches: pbMatches.map((m) => ({ brand: m.entry.brand, appliance: m.entry.appliance, likely_cause: m.entry.likely_cause, fix: m.entry.fix, easy: !!m.entry.easy, smarthq: !!m.entry.smarthq, matched: m.matched })),
      fault_code: faultMatch,
      recalls,
      bulletins,
      common_failures: commonFailures,
      similar_jobs: similarJobs,
      citations,
      code: code || null,
      role,
    }),
  };
};
