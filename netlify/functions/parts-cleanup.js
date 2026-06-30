// parts-cleanup — Danielle's one-pass "clean up Waiting Parts" tool. Surfaces
// EVERY job whose data parks it in the Waiting Parts folder — by office_stage
// ('parts') OR scheduling_status ('awaiting_parts') — and classifies each by its
// REAL state so the stragglers can be cleared in one pass:
//   • stray_canceled   — job is canceled but still flagged parts (just clutter)
//   • stray_completed  — job is done/closed but still flagged parts (just clutter)
//   • mislabeled       — parts_status "not_needed" → schedulable NOW, not waiting
//   • genuine          — really waiting on a part (leave it; shown for reference)
// This is why her count read 27 when only ~13 are truly waiting.
//
// GET  ?secret=<admin> | ?password=<office>            -> the classified list
// POST { action, job_id|ids, password|secret }
//   action=clear   -> drop office_stage (pull a stray out of Waiting Parts)
//   action=unpark  -> clear stage + scheduling_status->not_ready (back to schedule)
//   action=clear_bulk { ids:[...] } -> clear every id (one-pass straggler sweep)
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JOBS = 7, EVT = 3, DAY = 86400000;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function ms(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return v > 1e12 ? v : v * 1000; const t = Date.parse(v); return isNaN(t) ? 0 : t; }
async function officeOk(pw) { if (!pw) return false; try { const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }); const d = await r.json(); return !!(d && d.success === true); } catch (_) { return false; } }

function classify(jb) {
  const ss = String(jb.scheduling_status || '').toLowerCase();
  const cs = String(jb.current_status || '').toLowerCase();
  const ps = String(jb.parts_status || '').toLowerCase();
  if (/cancel/.test(ss) || /cancel/.test(cs)) return 'stray_canceled';
  if (ss === 'completed' || cs === 'completed') return 'stray_completed';
  if (ps === 'not_needed') return 'mislabeled';
  return 'genuine';
}

async function clearStage(jobId) {
  // office_stage is plain text → PUT writes cleanly. Drop the parts placement +
  // leave a breadcrumb so the board reads the cleared placement in one GET.
  await crud.update(JOBS, jobId, { office_stage: '' });
  await crud.logEvent('office_stage_set', { job_id: jobId, stage: '', service_state: '', actor: 'Danielle (parts cleanup)' });
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const pw = q.password || body.password;
  const ok = q.secret === admin || body.secret === admin || (await officeOk(pw));
  if (!ok) return j(401, { ok: false, error: 'unauthorized' });

  // ── ACTIONS ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const action = body.action || '';
    try {
      if (action === 'clear') {
        await clearStage(parseInt(body.job_id, 10));
        return j(200, { ok: true, cleared: parseInt(body.job_id, 10) });
      }
      if (action === 'unpark') {
        const id = parseInt(body.job_id, 10);
        await clearStage(id);
        // enum-safe status change through the state machine (NOT metadata).
        let r2 = null;
        try {
          const r = await fetch(`${XANO}/office_set_job_status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, scheduling_status: 'not_ready', actor: 'Danielle (parts cleanup)' }) });
          r2 = await r.json().catch(() => null);
        } catch (_) {}
        return j(200, { ok: true, unparked: id, status_result: r2 });
      }
      if (action === 'clear_bulk') {
        const ids = (Array.isArray(body.ids) ? body.ids : []).map((x) => parseInt(x, 10)).filter(Boolean);
        let done = 0; const failed = [];
        for (const id of ids) { try { await clearStage(id); done++; } catch (e) { failed.push(id); } }
        return j(200, { ok: true, cleared_count: done, failed });
      }
      return j(400, { ok: false, error: 'unknown action' });
    } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
  }

  // ── LIST ─────────────────────────────────────────────────────────────
  let byStatus = [], byStage = [];
  try {
    [byStatus, byStage] = await Promise.all([
      crud.searchPage(JOBS, { scheduling_status: 'awaiting_parts' }, { id: 'desc' }, 400),
      crud.searchPage(JOBS, { office_stage: 'parts' }, { id: 'desc' }, 400),
    ]);
  } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }

  const seen = new Map();
  for (const jb of [...byStatus, ...byStage]) if (!seen.has(jb.id)) seen.set(jb.id, jb);
  const jobs = [...seen.values()];

  // join customer names
  const custIds = [...new Set(jobs.map((x) => x.customer_id).filter(Boolean))];
  const cmap = new Map();
  await Promise.all(custIds.map((cid) => crud.searchPage(crud.TABLES.customer, { id: cid }, null, 1).then((r) => { if (r && r[0]) cmap.set(cid, r[0]); }).catch(() => {})));

  const now = Date.now();
  const groups = { stray_canceled: [], stray_completed: [], mislabeled: [], genuine: [] };
  for (const jb of jobs) {
    const c = cmap.get(jb.customer_id) || {};
    const eta = ms(jb.parts_eta_date);
    groups[classify(jb)].push({
      job_id: jb.id,
      customer: [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)',
      phone: c.phone || jb.customer_phone || '',
      appliance: [jb.brand, jb.appliance_type].filter(Boolean).join(' ') || '',
      scheduling_status: jb.scheduling_status || '', current_status: jb.current_status || '',
      parts_status: jb.parts_status || '', office_stage: jb.office_stage || '',
      warranty: jb.warranty_company || '', claim: jb.claim_number || '',
      age_days: Math.round((ms(jb.created_at) ? (now - ms(jb.created_at)) / DAY : 0) * 10) / 10,
      eta: jb.parts_eta_date || null,
      eta_overdue: !!(eta && eta < now),
    });
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => b.age_days - a.age_days);

  const strayCount = groups.stray_canceled.length + groups.stray_completed.length;
  return j(200, {
    ok: true,
    total_in_waiting_parts: jobs.length,
    truly_waiting: groups.genuine.length,
    strays_to_clear: strayCount,
    mislabeled_schedulable: groups.mislabeled.length,
    note: `Showing ${jobs.length} jobs flagged for Waiting Parts. ${groups.genuine.length} are really waiting; ${strayCount} are closed/canceled clutter; ${groups.mislabeled.length} are mislabeled (schedulable now).`,
    groups,
  });
};
