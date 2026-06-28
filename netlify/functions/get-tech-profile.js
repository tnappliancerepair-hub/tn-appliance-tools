// get-tech-profile — read the latest stored profile per tech (or one tech).
// Source: event_log 'tech_profile_v1' rows; latest wins per technician_id.
//   GET ?tech_id=2     -> that tech's profile
//   GET                -> latest profile for every tech (map)
'use strict';

const crud = require('./_lib/xano/metadata-crud');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'tech_profile_v1' }, { id: 'desc' }, 300); } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
  const latest = {}; // techId -> profile (first seen = newest, since id desc)
  for (const r of rows) {
    const m = meta(r);
    const tid = Number(m.technician_id || 0);
    if (!tid || latest[tid]) continue;
    latest[tid] = { technician_id: tid, name: m.name || '', updated_at_ms: m.at_ms || null, profile: m.profile || {} };
  }
  const want = Number(q.tech_id || 0);
  if (want) return j(200, { ok: true, technician_id: want, found: !!latest[want], ...(latest[want] || {}) });
  return j(200, { ok: true, count: Object.keys(latest).length, profiles: latest });
};
