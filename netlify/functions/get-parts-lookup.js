// get-parts-lookup — Teddy Tool polls this for the parts daemon's result after
// firing request-parts-lookup. Reads the latest event_log 'parts_lookup_result'
// row matching the request_id (preferred) or job_id.
//
//   GET ?request_id=pl_18537_1718... [&job_id=18537]
//   -> { ok, found, result }   (found:false = still working / not run yet)

'use strict';
const crud = require('./_lib/xano/metadata-crud');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

function asObj(metadata) {
  if (metadata == null) return {};
  if (typeof metadata === 'object') return metadata;
  try { return JSON.parse(metadata); } catch (_) { return {}; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = (event.queryStringParameters || {});
  const requestId = String(q.request_id || '').slice(0, 80);
  const jobId = parseInt(String(q.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!requestId && !jobId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'request_id or job_id required' }) };
  }

  try {
    // event_log metadata is a JSON column (single-field Metadata search can't peer
    // inside it), so pull recent parts_lookup_result rows by action, newest first,
    // and match request_id/job_id client-side. Volume is low — this is cheap.
    const rows = await crud.searchPage(
      crud.TABLES.event_log,
      { action: 'parts_lookup_result' },
      { created_at: 'desc' },
      50
    );
    for (const row of rows) {
      const md = asObj(row.metadata);
      if (requestId && String(md.request_id || '') === requestId) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, found: true, result: md }) };
      }
      if (!requestId && jobId && Number(md.job_id) === jobId) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, found: true, result: md }) };
      }
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, found: false }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
