// set-tdr-field — write a single TDR text field on an existing report row via
// the Metadata API. Exists because update_tdr_field_from_voice doesn't map
// every TDR column (e.g. failure_cause), and the office sometimes needs to
// complete one field for a warranty submission without creating a duplicate
// TDR. Whitelisted fields only.
//
//   POST { tdr_id, field, value }
'use strict';

const md = require('./_lib/xano/metadata-crud');
const TDR_TABLE = 12; // technician_decision_report

const ALLOWED = new Set([
  'diagnosis', 'failure_cause', 'failure_cause_notes', 'failed_component',
  'repair_completed', 'verified_part_number', 'customer_facing_diagnosis',
  'technician_notes', 'parts_used', 'parts_not_used',
  'labor_time_hours', 'parts_needed',
]);
// JSON (array) columns — value is parsed/written as an array, not a string.
const JSON_FIELDS = new Set(['parts_used', 'parts_not_used', 'parts_needed']);

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }

  const tdrId = Number(b.tdr_id);
  const field = String(b.field || '').trim();
  if (!tdrId) return j(400, { ok: false, error: 'tdr_id required' });
  if (!ALLOWED.has(field)) return j(400, { ok: false, error: 'field not allowed', allowed: [...ALLOWED] });

  // JSON fields take an array (or a JSON string); text fields take a string.
  let value;
  if (JSON_FIELDS.has(field)) {
    let arr = b.value;
    if (typeof arr === 'string') {
      const s = arr.trim();
      if (!s) arr = [];
      else { try { const p = JSON.parse(s); arr = Array.isArray(p) ? p : [s]; } catch (_) { arr = [s]; } }
    }
    value = Array.isArray(arr) ? arr : [];
  } else {
    value = String(b.value == null ? '' : b.value);
  }

  try {
    // Xano's content PUT replaces the row, so read-modify-write: load the
    // current TDR, set just the one field, write the whole thing back.
    const rows = await md.search(TDR_TABLE, { id: tdrId });
    const row = Array.isArray(rows) ? rows.find((r) => Number(r.id) === tdrId) || rows[0] : null;
    if (!row) return j(404, { ok: false, error: 'tdr not found', tdr_id: tdrId });
    const merged = Object.assign({}, row, { [field]: value });
    delete merged.id;            // id is in the path, not the body
    delete merged.created_at;    // don't try to rewrite the timestamp
    await md.update(TDR_TABLE, tdrId, merged);
    return j(200, { ok: true, tdr_id: tdrId, field, value });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e), detail: (e && e.body) ? String(e.body).slice(0, 400) : undefined });
  }
};
