// brain-autolearn — the flywheel, automated (Teddy 2026-08-20). Every closed job's
// outcome should flow into the brain by itself — no manual Q&A. Teddy's simplified model
// is the whole knowledge row:
//     { model, symptom, solved_part, did_not_solve_parts[] }
// The did-NOT-solve part number is the gold: recording what got tried and DIDN'T work is
// the negative signal that lifts first-guess accuracy (skip the part techs waste a trip on).
// It's derived automatically from REPEAT VISITS — when the same appliance comes back for the
// same problem, the earlier trip's part didn't solve it; the closing trip's part did.
//
// This sweep, hourly:
//   1. reads recent jobs the brain predicted on (job_id + model context),
//   2. pulls each job's actual TDR outcome (solved part + component + diagnosis),
//   3. derives did-not-solve parts from that job's prior linked visits (job-history),
//   4. CAPTURES the 4-field row durably as `knowledge_captured`,
//   5. AUTO-FILLS any open knowledge gap that job now answers.
// Sourced only from REAL closed jobs — never a guess. Idempotent (one capture per job).
// Kill: BRAIN_AUTOLEARN=false.   Inspect: ?dry=1 (with ?secret=).
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const OWNER = '+16154855795';
const PER_RUN = 18;      // jobs processed per run (hourly + dedup → catches up fast)
const BATCH = 6;         // concurrent per batch (keeps the 26s budget)

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function jfetch(url, opts, ms) { try { const r = await fetch(url, { ...(opts || {}), signal: AbortSignal.timeout(ms || 6000) }); return await r.json(); } catch (_) { return null; } }
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const low = (s) => String(s || '').toLowerCase().trim();
// platform-family match: exact, or the shorter is a prefix of the longer (WTW5000DW ↔ WTW5000DW1).
function familyMatch(a, b) { a = norm(a); b = norm(b); if (!a || !b) return false; if (a === b) return true; const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 6 && l.startsWith(s); }
// Gap key, EXACTLY like knowledge-gap.js keyOf() (in-process gaps store no key).
function keyOf(m) {
  const b = low(m.brand) || '?', a = low(m.appliance) || '?';
  if (m.code) return `code|${b}|${a}|${low(m.code).replace(/[\s\-_.]/g, '')}`;
  if (m.model) return `model|${b}|${a}|${low(m.model)}`;
  return `sym|${b}|${a}|${low(m.symptom).slice(0, 40)}`;
}

// Process ONE job: pull its outcome + derive the did-not-solve parts from prior visits.
// Returns the captured row (no writes here — the handler batches those).
async function processJob(jid, pm) {
  const d = await jfetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jid }) }, 6000);
  const tdr = (d && d.tdr) || null;
  const appl = (d && d.appliance) || {};
  const solvedPart = (tdr && (tdr.verified_part_number || '')) || '';
  const comp = (tdr && (tdr.failed_component || '')) || '';
  const diag = (tdr && (tdr.diagnosis || '')) || '';
  const done = tdr && (/complete|done/i.test(String(tdr.status || '')) || tdr.repair_completed || solvedPart);
  if (!tdr || !done || (!solvedPart && !comp)) return null;     // no real outcome yet

  const model = appl.model_number || appl.model || pm.model || '';
  const brand = appl.brand || pm.brand || '';
  const appType = appl.type || appl.appliance_type || pm.appliance || '';
  const symptom = appl.problem_summary || pm.symptom || '';

  // NEGATIVE SIGNAL — did-not-solve parts from this appliance's prior linked visits.
  // A prior same-appliance visit that put in a DIFFERENT part than the one that finally
  // closed it = a part that did NOT solve this model+symptom.
  const didNot = [];
  if (solvedPart) {
    const h = await jfetch(`${BASE}/job-history?job_id=${jid}`, {}, 5000);
    const prior = (h && h.prior) || [];
    const sp = norm(solvedPart); const seen = new Set();
    for (const p of prior) {
      if (!p || !p.same_appliance) continue;
      const pn = String(p.part || '').trim(); if (!pn) continue;
      const k = norm(pn); if (!k || k === sp || seen.has(k)) continue;
      seen.add(k); didNot.push(pn);
    }
  }

  return { jid, model, brand, appType, symptom, comp, diag, solvedPart, didNot, dtext: norm(diag) + ' ' + norm(symptom) };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dry === '1';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse((event && event.body) || '{}').next_run; } catch (_) {}
  if (!dry && !scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (String(await getSecret('BRAIN_AUTOLEARN') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });

  let gapRows = [], fillRows = [], capRows = [], preds = [];
  try {
    gapRows = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_gap' }, { id: 'desc' }, 500);
    fillRows = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_gap_filled' }, { id: 'desc' }, 500);
    capRows = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_captured' }, { id: 'desc' }, 500);
    preds = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_prediction' }, { id: 'desc' }, 400);
  } catch (e) { return json(200, { ok: false, error: 'read failed' }); }

  const filled = new Set((fillRows || []).map((r) => String(metaOf(r).key || '')).filter(Boolean));
  const openByKey = new Map();
  for (const r of gapRows || []) { const m = metaOf(r); const k = keyOf(m); if (!k || k.endsWith('|?|?|') || filled.has(k) || openByKey.has(k)) continue; m.__key = k; openByKey.set(k, m); }
  const openGaps = [...openByKey.values()];
  const capturedJobs = new Set((capRows || []).map((r) => Number(metaOf(r).job_id)).filter(Boolean));

  const jobs = new Map();
  for (const r of preds || []) { const m = metaOf(r); const jid = Number(m.job_id); if (!jid || jobs.has(jid)) continue; jobs.set(jid, m); }

  const todo = [...jobs.entries()].filter(([jid]) => !capturedJobs.has(jid)).slice(0, PER_RUN);
  const results = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const r = await Promise.all(batch.map(([jid, pm]) => processJob(jid, pm).catch(() => null)));
    results.push(...r.filter(Boolean));
  }

  // Apply: capture the 4-field row + auto-fill matching gaps. Batch the writes.
  const captured = [], gapsFilled = [], fillKeys = new Set(), writes = [];
  for (const res of results) {
    captured.push({ job_id: res.jid, model: res.model, symptom: String(res.symptom).slice(0, 60), solved_part: res.solvedPart, did_not_solve: res.didNot });
    if (!dry) writes.push(crud.logEvent('knowledge_captured', {
      job_id: res.jid, model: res.model, brand: res.brand, appliance: res.appType,
      symptom: String(res.symptom).slice(0, 120), component: res.comp,
      solved_part: res.solvedPart, did_not_solve_parts: res.didNot,
      cause: String(res.diag || res.symptom || '').slice(0, 180), source: 'closed_job', at_ms: Date.now(),
    }).catch(() => {}));

    for (const g of openGaps) {
      if (fillKeys.has(g.__key)) continue;
      const gAppl = low(g.appliance), jAppl = low(res.appType);
      const applOk = !gAppl || !jAppl || gAppl === jAppl;
      let hit = false;
      if (g.code) { const code = norm(g.code); if (code && res.dtext.includes(code) && applOk) hit = true; }
      else if (g.model && res.model) { if (familyMatch(g.model, res.model) && applOk) hit = true; }
      if (hit) { fillKeys.add(g.__key); gapsFilled.push({ key: g.__key, by_job: res.jid }); if (!dry) writes.push(crud.logEvent('knowledge_gap_filled', { key: g.__key, by: 'autolearn', source_job: res.jid, at_ms: Date.now() }).catch(() => {})); }
    }
  }
  if (!dry && writes.length) await Promise.all(writes);

  const negatives = captured.reduce((n, c) => n + (c.did_not_solve || []).length, 0);
  if (!dry && (gapsFilled.length || negatives)) {
    const body = `[ant] 🧠 Auto-learned from ${captured.length} closed job(s)` +
      (gapsFilled.length ? ` — filled ${gapsFilled.length} gap(s)` : '') +
      (negatives ? ` + ${negatives} did-not-solve part(s)` : '') + ':\n' +
      gapsFilled.slice(0, 5).map((g) => '  • ' + String(g.key).split('|').slice(1).join(' ')).join('\n');
    try { await sendSms(OWNER, body, 'owner', 'brain_autolearn'); } catch (_) {}
  }

  return json(200, {
    ok: true, mode: dry ? 'dry' : 'live',
    jobs_seen: jobs.size, processed: results.length, captured: captured.length,
    did_not_solve_captured: negatives, gaps_filled: gapsFilled.length, open_gaps: openGaps.length,
    captured_list: captured.slice(0, 12), gaps_filled_list: gapsFilled.slice(0, 12),
  });
};
