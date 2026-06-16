// get-model-intel — read the cached MSA/Whirlpool model intelligence (recalls,
// bulletins, tech-sheets) for a model from event_log. Used by ant-troubleshoot
// and any UI that wants to show recalls.
//
//   GET ?brand=Whirlpool&model=WTW5000DW1   (or ?request_id=mi_...)
//   -> { ok, found, result, age_ms }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

function asObj(m) { if (m == null) return {}; if (typeof m === 'object') return m; try { return JSON.parse(m); } catch (_) { return {}; } }
function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// shared so ant-troubleshoot can read the cache in-process (no HTTP hop)
async function readModelIntel({ request_id, brand, model }) {
  const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'model_intel_result' }, { created_at: 'desc' }, 60);
  const wantModel = norm(model), wantBrand = norm(brand);
  for (const row of rows) {
    const md = asObj(row.metadata);
    if (request_id && String(md.request_id || '') === request_id) return { row, md };
    if (!request_id && wantModel && norm(md.model) === wantModel) return { row, md };
    if (!request_id && !wantModel && wantBrand && norm(md.brand) === wantBrand) return { row, md };
  }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const request_id = String(q.request_id || '').slice(0, 80);
  const brand = String(q.brand || '').slice(0, 40);
  const model = String(q.model || '').slice(0, 60);
  if (!request_id && !brand && !model) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'brand/model or request_id required' }) };
  try {
    const hit = await readModelIntel({ request_id, brand, model });
    if (!hit) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, found: false }) };
    const created = Number(hit.row.created_at) || 0;
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, found: true, result: hit.md, age_ms: created ? (Date.now() - created) : null }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};

module.exports.readModelIntel = readModelIntel;
