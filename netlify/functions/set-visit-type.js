// set-visit-type — tech (or office) marks a job as a COMPLETION or a DIAGNOSIS
// when Ant can't tell on its own. This matters during the HCP cutover: jobs that
// were already diagnosed in HCP came into Ant as shells (no TDR, parts not_needed),
// so the auto-detector shows DIAGNOSIS even though the tech knows it's a completion.
// The override is read by get-visit-types and wins over auto-detection on both the
// tech dashboard and the office board.
//
//   POST { job_id, type:'completion'|'diagnosis', by? }  -> { ok }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || 0);
  const type = String(b.type || '').toLowerCase();
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  if (type !== 'completion' && type !== 'diagnosis') return j(400, { ok: false, error: "type must be 'completion' or 'diagnosis'" });
  try {
    await crud.logEvent('visit_type_override', { job_id: jobId, type, by: String(b.by || 'tech'), at_ms: Date.now() });
    return j(200, { ok: true, job_id: jobId, type });
  } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
};
