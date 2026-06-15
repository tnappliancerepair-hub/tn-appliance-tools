// office-stage — durable board placement WITHOUT a Mac/XS push. Writes the
// card's column (jobs.office_stage) and optional region (jobs.service_state)
// straight to the job row via the Metadata API (both are plain-text columns,
// which the Metadata API writes cleanly). Also drops an event_log breadcrumb so
// the board can bulk-READ everyone's placement in one call (search by action).
//
//   POST { job_id, stage, service_state? }  -> persist placement (+ region)
//   GET                                     -> { ok, stages: { <id>: {office_stage, service_state} } }
//
// The office board page is already office-password gated, and this can only set
// a placement string + a TN/LA region on a job — so it runs open like the other
// board endpoints (the Metadata token stays server-side).

'use strict';

const crud = require('./_lib/xano/metadata-crud');
const JOBS_TABLE = 7;
const EVENT_LOG_TABLE = 3;

function normState(s) {
  const v = String(s || '').trim().toUpperCase();
  if (v === 'LA' || v === 'NOLA' || v === 'LOUISIANA') return 'LA';
  if (v === 'TN' || v === 'TENNESSEE') return 'TN';
  return '';
}

exports.handler = async function (event) {
  try {
    // READ: latest placement + checklist per job, from the event_log breadcrumbs.
    if (event.httpMethod === 'GET') {
      const [stageRows, chkRows] = await Promise.all([
        crud.searchPage(EVENT_LOG_TABLE, { action: 'office_stage_set' }, { created_at: 'desc' }, 400),
        crud.searchPage(EVENT_LOG_TABLE, { action: 'office_checklist_set' }, { created_at: 'desc' }, 400),
      ]);
      const stages = {};
      for (const r of stageRows) {
        let m = r && r.metadata;
        if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
        m = m || {};
        const id = m.job_id;
        if (id == null || stages[id] !== undefined) continue;
        stages[id] = { office_stage: m.stage || '', service_state: m.service_state || '' };
      }
      const checklists = {};
      for (const r of chkRows) {
        let m = r && r.metadata;
        if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
        m = m || {};
        const id = m.job_id;
        if (id == null || checklists[id] !== undefined) continue;
        checklists[id] = Array.isArray(m.checklist) ? m.checklist : [];
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, stages, checklists }) };
    }

    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const b = JSON.parse(event.body || '{}');
    const jobId = parseInt(b.job_id, 10);
    if (!jobId) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'job_id required' }) };

    // Checklist save (manual ticks) — separate from stage so it never blanks it.
    if (Array.isArray(b.checklist)) {
      const list = b.checklist.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
      await crud.logEvent('office_checklist_set', { job_id: jobId, checklist: list, actor: (b.actor || 'office') });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, success: true, job_id: jobId, checklist: list }) };
    }
    const stage = String(b.stage || '').trim();
    const st = normState(b.service_state);

    // Write to the job row (canonical). Only touch service_state when a valid
    // region was passed, so a normal column-move never changes the region.
    const partial = { office_stage: stage };
    if (st) partial.service_state = st;
    await crud.update(JOBS_TABLE, jobId, partial);

    // Breadcrumb so the board can read everyone's placement in one GET.
    await crud.logEvent('office_stage_set', { job_id: jobId, stage, service_state: st, actor: (b.actor || 'office') });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, success: true, job_id: jobId, office_stage: stage, service_state: st }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, success: false, error: String((e && e.message) || e) }) };
  }
};
