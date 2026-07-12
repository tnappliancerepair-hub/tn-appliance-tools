// get-stop-machines — given ANY machine's job_id, return the whole stop's machine list
// (primary first), so the tech tile can render a machine switcher and Danielle can group
// them. Linking lives in event_log `stop_machine` markers written by add-machine.
//
//   GET ?job_id=<any machine on the stop>
//     -> { ok, stop_id, count, machines: [{ job_id, appliance, brand, model, problem,
//            status, is_primary, has_report }] }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// The TDR (diagnosis/notes) lives in its OWN table, not on the job row — so we ask
// the dashboard endpoint (which joins the TDRs) whether this machine has a real
// report. A machine has a report if any of its TDRs carries a filled field.
async function jobHasReport(id) {
  try {
    const r = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id }), signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    const rows = (d && d.all_tdrs) || [];
    return rows.some((t) => ['diagnosis', 'technician_notes', 'repair_completed', 'failed_component'].some((k) => String((t && t[k]) || '').trim()));
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const jobId = parseInt(String(q.job_id || '').replace(/\D/g, ''), 10);
  if (!jobId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'job_id required' }) };

  // pull the stop links (recent — a stop's machines are all added the same day)
  let links = [];
  try { links = await crud.searchPage(crud.TABLES.event_log, { action: 'stop_machine' }, { id: 'desc' }, 400); }
  catch (_) { links = []; }
  links = (links || []).filter((r) => r && r.metadata && Number(r.metadata.machine_job_id) > 0 && Number(r.metadata.stop_id) > 0);

  // resolve the stop_id: if jobId is a child, use its stop_id; else jobId is the stop.
  let stopId = jobId;
  const asChild = links.find((r) => Number(r.metadata.machine_job_id) === jobId);
  if (asChild) stopId = Number(asChild.metadata.stop_id);

  // the machine job_ids = the stop itself + every child linked to it (dedup, keep order)
  const ids = [stopId];
  for (const r of links.slice().reverse()) { // oldest first so switcher order is stable
    if (Number(r.metadata.stop_id) === stopId) {
      const mid = Number(r.metadata.machine_job_id);
      if (mid > 0 && ids.indexOf(mid) < 0) ids.push(mid);
    }
  }

  // hydrate each machine job
  const machines = [];
  for (const id of ids) {
    let row = null;
    try { row = await crud.searchOne(crud.TABLES.jobs, { id }); } catch (_) {}
    if (!row) continue;
    const status = String(row.scheduling_status || row.current_status || '').trim();
    const hasReport = await jobHasReport(id);
    machines.push({
      job_id: id,
      appliance: String(row.appliance_type || '').trim() || 'appliance',
      brand: String(row.brand || '').trim(),
      model: String(row.model_number || '').trim(),
      problem: String(row.problem_summary || '').trim(),
      status,
      is_primary: id === stopId,
      has_report: hasReport,
    });
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, stop_id: stopId, count: machines.length, machines }) };
};
