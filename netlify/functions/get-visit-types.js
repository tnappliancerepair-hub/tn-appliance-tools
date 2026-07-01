// get-visit-types — returns the latest tech/office visit-type override per job
// (completion | diagnosis), so the tech dashboard + office board can honor a
// human's call over the auto-detector. Newest override per job_id wins.
//
//   GET  -> { ok, overrides: { "<job_id>": "completion"|"diagnosis", ... } }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'visit_type_override' }, { id: 'desc' }, 500) || []; } catch (_) {}
  const overrides = {};
  // rows are newest-first; first seen per job_id wins.
  for (const r of rows) {
    const m = metaOf(r);
    const jid = String(m.job_id || '');
    if (jid && overrides[jid] === undefined) overrides[jid] = String(m.type || '');
  }
  return j(200, { ok: true, overrides });
};
