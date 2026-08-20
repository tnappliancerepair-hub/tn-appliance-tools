// brain-autolearn — the flywheel, automated (Teddy 2026-08-20: "this needs to be
// automated"). Every time a tech CLOSES a job with a real diagnosis, the outcome should
// flow into the brain by itself — no manual Q&A. This sweep does exactly that:
//   1. reads recent jobs the brain predicted on (they carry job_id + model context),
//   2. pulls each job's actual TDR outcome (failed component + part + diagnosis),
//   3. CAPTURES it durably as a `knowledge_captured` event (model → component/part/cause),
//   4. AUTO-FILLS any open knowledge gap that job now answers (same model family, or the
//      exact fault code appearing in the diagnosis) — logging `knowledge_gap_filled`.
// So "every I-don't-know becomes a permanent now-I-know" happens on its own, sourced only
// from REAL closed jobs (tech outcomes) — never a guess. Reuses ant-brain-grade's proven
// job→TDR read path. Idempotent (one capture per job). Kill: BRAIN_AUTOLEARN=false. ?dry=1.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function jfetch(url, opts) { try { const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(6000) }); return await r.json(); } catch (_) { return null; } }
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const low = (s) => String(s || '').toLowerCase().trim();
// platform-family match: exact, or the shorter is a prefix of the longer (WTW5000DW ↔ WTW5000DW1).
function familyMatch(a, b) { a = norm(a); b = norm(b); if (!a || !b) return false; if (a === b) return true; const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 6 && l.startsWith(s); }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dry === '1';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse((event && event.body) || '{}').next_run; } catch (_) {}
  if (!dry && !scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (String(await getSecret('BRAIN_AUTOLEARN') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });

  // Pull the ledgers we need in one shot.
  let gapRows = [], fillRows = [], capRows = [], preds = [];
  try {
    gapRows = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_gap' }, { id: 'desc' }, 500);
    fillRows = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_gap_filled' }, { id: 'desc' }, 500);
    capRows = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_captured' }, { id: 'desc' }, 500);
    preds = await crud.searchPage(crud.TABLES.event_log, { action: 'ant_brain_prediction' }, { id: 'desc' }, 400);
  } catch (e) { return json(200, { ok: false, error: 'read failed' }); }

  // OPEN gaps = latest knowledge_gap per key with no newer fill.
  const filled = new Set((fillRows || []).map((r) => String(metaOf(r).key || '')).filter(Boolean));
  const openByKey = new Map();
  for (const r of gapRows || []) { const m = metaOf(r); const k = m.key; if (!k || filled.has(k) || openByKey.has(k)) continue; openByKey.set(k, m); }
  const openGaps = [...openByKey.values()];

  const capturedJobs = new Set((capRows || []).map((r) => Number(metaOf(r).job_id)).filter(Boolean));

  // Newest prediction per job = the recent-job list with model context.
  const jobs = new Map();
  for (const r of preds || []) { const m = metaOf(r); const jid = Number(m.job_id); if (!jid || jobs.has(jid)) continue; jobs.set(jid, m); }

  const captured = [], gapsFilled = [];
  let processed = 0;
  for (const [jid, pm] of jobs) {
    if (capturedJobs.has(jid)) continue;        // one capture per job (idempotent)
    if (processed >= 40) break;                 // per-run budget
    processed++;
    const d = await jfetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jid }) });
    const tdr = (d && d.tdr) || null;
    const appl = (d && d.appliance) || {};
    const part = (tdr && (tdr.verified_part_number || '')) || '';
    const comp = (tdr && (tdr.failed_component || '')) || '';
    const diag = (tdr && (tdr.diagnosis || '')) || '';
    const done = tdr && (/complete|done/i.test(String(tdr.status || '')) || tdr.repair_completed || part);
    if (!tdr || !done || (!part && !comp)) continue;      // no real outcome yet → skip (still pending)

    const model = appl.model_number || appl.model || pm.model || '';
    const brand = appl.brand || pm.brand || '';
    const appType = appl.type || appl.appliance_type || pm.appliance || '';
    const symptom = appl.problem_summary || pm.symptom || '';

    if (!dry) { try { await crud.logEvent('knowledge_captured', { job_id: jid, model, brand, appliance: appType, component: comp, part, cause: String(diag || symptom || '').slice(0, 180), symptom: String(symptom).slice(0, 120), source: 'closed_job', at_ms: Date.now() }); } catch (_) {} }
    captured.push({ job_id: jid, model, component: comp, part });

    // Auto-fill any open gap this closed job now answers.
    const dtext = norm(diag) + ' ' + norm(symptom);
    for (const g of openGaps) {
      if (g.__done) continue;
      const gAppl = low(g.appliance), jAppl = low(appType);
      const applOk = !gAppl || !jAppl || gAppl === jAppl;
      let hit = false;
      if (g.code) { const code = norm(g.code); if (code && dtext.includes(code) && applOk) hit = true; }
      else if (g.model && model) { if (familyMatch(g.model, model) && applOk) hit = true; }
      if (hit) { g.__done = true; gapsFilled.push({ key: g.key, by_job: jid }); if (!dry) { try { await crud.logEvent('knowledge_gap_filled', { key: g.key, by: 'autolearn', source_job: jid, at_ms: Date.now() }); } catch (_) {} } }
    }
  }

  // Low-key owner ping only when it actually learned something (filled a gap).
  if (!dry && gapsFilled.length) {
    const body = `[ant] 🧠 Auto-learned from ${captured.length} closed job(s) — filled ${gapsFilled.length} knowledge gap(s) with real field outcomes:\n` +
      gapsFilled.slice(0, 6).map((g) => '  • ' + String(g.key).split('|').slice(1).join(' ')).join('\n');
    try { await sendSms(OWNER, body, 'owner', 'brain_autolearn'); } catch (_) {}
  }

  return json(200, {
    ok: true, mode: dry ? 'dry' : 'live',
    jobs_seen: jobs.size, processed, captured: captured.length, gaps_filled: gapsFilled.length, open_gaps: openGaps.length,
    captured_list: captured.slice(0, 12), gaps_filled_list: gapsFilled.slice(0, 12),
  });
};
