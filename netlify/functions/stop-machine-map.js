// stop-machine-map — the board's grouping index. An AHS multi-item claim becomes
// several linked jobs (one machine each, own TDR/warranty) via add-machine, which
// logs a `stop_machine` event {stop_id, machine_job_id, appliance}. The office board
// reads this map to COLLAPSE the siblings into one tile (Danielle: "need it all show
// on one but have the separate TDRs") while each machine keeps its own job + TDR.
//
//   GET -> { ok, stops: { "<stop_id>": [ {job_id, appliance} ... ] }, child_of: { "<job_id>": <stop_id> } }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' };

exports.handler = async function () {
  try {
    // Newest 400 stop_machine links (plenty — a rare event; table-3 caps per_page ~500).
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'stop_machine' }, { id: 'desc' }, 400);
    const stops = {}; const childOf = {};
    for (const r of (rows || [])) {
      const m = (r && r.metadata) || {};
      const stopId = Number(m.stop_id || 0);
      const jobId = Number(m.machine_job_id || 0);
      if (!stopId || !jobId || stopId === jobId) continue;
      if (childOf[jobId] !== undefined) continue; // newest already recorded (id desc)
      childOf[jobId] = stopId;
      (stops[stopId] = stops[stopId] || []).push({ job_id: jobId, appliance: String(m.appliance || '').trim() });
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, stops, child_of: childOf }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e), stops: {}, child_of: {} }) };
  }
};
