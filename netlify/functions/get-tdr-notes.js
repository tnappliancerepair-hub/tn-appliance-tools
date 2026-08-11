// get-tdr-notes — returns the latest TDR's technician_notes for a job so the tech card
// can show back the situational Notes it saved. Needed because get_unified_tdr_status
// returns customer_notes (a JSON/list column whose string writes silently no-op — the
// reason the Notes field looked like it "wasn't saving"), NOT technician_notes, which is
// the reliable string column the OFFICE board reads. The card saves to technician_notes
// via set-tdr-field and reads it back here. Read-only, Metadata API. (Teddy 2026-08-11)
//
//   GET ?job_id=<n>  ->  { ok, technician_notes }
'use strict';
const md = require('./_lib/xano/metadata-crud');
const TDR_TABLE = 12; // technician_decision_report

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  const q = event.queryStringParameters || {};
  const jobId = Number(q.job_id || 0);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  try {
    const rows = await md.searchPage(TDR_TABLE, { job_id: jobId }, { created_at: 'desc' }, 25);
    const list = Array.isArray(rows) ? rows : ((rows && rows.items) || []);
    // newest TDR row that actually has a note wins (mirrors how the office board picks it)
    let notes = '';
    for (const r of list) { const n = String((r && r.technician_notes) || '').trim(); if (n) { notes = n; break; } }
    return j(200, { ok: true, technician_notes: notes });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
