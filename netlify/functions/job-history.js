// job-history — "what did we do last time?" Surfaces a customer's PRIOR jobs on the same
// appliance (Teddy 2026-08-13, from Jimmy: "no previous history on some jobs"). When a
// warranty company re-dispatches a return trip it's a NEW job record, so the tile's own
// TDR shows nothing — the prior visit's diagnosis + part number live on the OLD record.
// This pulls those sibling records (same customer, same appliance first) and each one's
// report summary, so the tech/office always sees the last visit's work + parts, even
// across separate job records.
//
//   GET ?job_id=<id>  ->  { ok, job_id, appliance, prior:[{job_id, when, tech, appliance,
//                           status, diagnosis, failed_component, part, claim, same_appliance}] }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const JOBS = 7, TDR = 12;
const TECH = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

// A real part-number token: letters + >=3 digits, len>=5 (matches backfill's rule).
function partToken(s) { const m = String(s || '').match(/\b([A-Za-z0-9]*[A-Za-z][A-Za-z0-9-]*\d[A-Za-z0-9-]*)\b/g); if (!m) return ''; for (const t of m) { const d = (t.match(/\d/g) || []).length; if (t.replace(/-/g, '').length >= 5 && d >= 3) return t; } return ''; }
function partOf(x) {
  if (!x) return '';
  if (x.verified_part_number && String(x.verified_part_number).trim()) return String(x.verified_part_number).trim();
  const pn = x.parts_needed;
  if (Array.isArray(pn)) { for (const v of pn) { const t = partToken(v); if (t) return t; } }
  else if (pn) { const t = partToken(pn); if (t) return t; }
  return partToken(x.failed_component) || '';
}
function whenCT(v) {
  const ms = Number(v || 0); if (!ms) return '';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms)); } catch (_) { return ''; }
}
const applOf = (r) => String((r && (r.appliance_type || r.appliance)) || '').toLowerCase().trim();

exports.config = { timeout: 20 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const jobId = Number(q.job_id || 0);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  let cur = null;
  try { cur = await crud.searchOne(JOBS, { id: jobId }); } catch (_) {}
  if (!cur || !cur.customer_id) return j(200, { ok: true, job_id: jobId, prior: [] });
  const appl = applOf(cur);

  // All of this customer's jobs (single-field search — metadata API can't AND fields).
  let rows = [];
  try { rows = (await crud.searchPage(JOBS, { customer_id: cur.customer_id }, { id: 'desc' }, 100)) || []; } catch (_) {}
  rows = rows.filter((r) => Number(r.id) !== jobId && !/^cancel/i.test(String(r.scheduling_status || '')));
  // Same appliance first, then newest.
  rows.sort((a, b) => { const aa = applOf(a) === appl ? 0 : 1, bb = applOf(b) === appl ? 0 : 1; return aa !== bb ? aa - bb : Number(b.id) - Number(a.id); });
  const top = rows.slice(0, 6);

  const prior = await Promise.all(top.map(async (r) => {
    let tdr = null;
    try {
      const ts = (await crud.searchPage(TDR, { job_id: Number(r.id) }, { id: 'desc' }, 4)) || [];
      tdr = ts.find((t) => t && (t.diagnosis || t.failed_component || t.verified_part_number || t.repair_completed)) || ts[0] || null;
    } catch (_) {}
    const techId = (tdr && tdr.technician_id) || r.technician_id;
    return {
      job_id: Number(r.id),
      when: whenCT(r.scheduled_start || r.updated_at || r.created_at),
      tech: TECH[techId] || '',
      appliance: r.appliance_type || r.appliance || '',
      status: r.scheduling_status || r.current_status || '',
      diagnosis: (tdr && String(tdr.diagnosis || '').trim().slice(0, 180)) || '',
      failed_component: (tdr && String(tdr.failed_component || '').trim()) || '',
      part: partOf(tdr) || partOf(r) || '',
      claim: r.claim_number || '',
      same_appliance: applOf(r) === appl,
    };
  }));

  return j(200, { ok: true, job_id: jobId, appliance: appl, customer_id: cur.customer_id, count: prior.length, prior });
};
