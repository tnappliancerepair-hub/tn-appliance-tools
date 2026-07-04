// ensure-tdr — get-or-create a technician_decision_report row for a job WITHOUT
// firing the TDR_SUBMITTED colony signal. create_tdr emits TDR_SUBMITTED, which
// makes the loop's router autonomously move the job between folders — exactly
// what Danielle asked us to STOP. So the inline TDR editor (ant-tdr-card.js)
// creates its row here, side-effect-free, then writes fields via set-tdr-field.
// (Teddy 2026-07-04 — "make it easy to edit and complete the TDR, remove all friction")
//
//   POST { job_id, technician_id? }  ->  { ok, tdr_id, created }
'use strict';

const md = require('./_lib/xano/metadata-crud');
const TDR_TABLE = 12; // technician_decision_report
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}
function rowsOf(r) { return Array.isArray(r) ? r : ((r && (r.items || r.rows)) || []); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }
  const jobId = Number(b.job_id);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  // Resolve the tech the TDR should belong to. The card reads the same lens:
  // technician_id (explicit) else the job's assigned tech else 0. Match it so
  // get_unified_tdr_status finds the row we create.
  let techId = (b.technician_id != null && b.technician_id !== '') ? Number(b.technician_id) : null;
  if (techId == null) {
    try {
      const r = await fetch(`${XANO}/get_unified_tdr_status?job_id=${jobId}`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d && Number(d.tdr_id) > 0) return j(200, { ok: true, tdr_id: Number(d.tdr_id), created: false });
      techId = Number((d && d.technician_id) || 0);
    } catch (_) { techId = 0; }
  }

  // Existing row for this job+tech? (single-field search — Xano ignores multi-field)
  try {
    const found = rowsOf(await md.searchPage(TDR_TABLE, { job_id: jobId }, { created_at: 'desc' }, 25));
    const match = found.find((r) => Number(r.technician_id || 0) === Number(techId));
    if (match) return j(200, { ok: true, tdr_id: Number(match.id), created: false });
  } catch (_) {}

  // Create a minimal row — no signal, no folder move.
  try {
    const created = await md.insert(TDR_TABLE, { job_id: jobId, technician_id: techId, status: 'in_progress', report_date: Date.now() });
    const id = created && (created.id || (created.body && created.body.id));
    if (!id) return j(200, { ok: false, error: 'insert_no_id' });
    return j(200, { ok: true, tdr_id: Number(id), created: true });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
