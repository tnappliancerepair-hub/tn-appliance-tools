// stranded-jobs — the safety net for "we accepted a job and it didn't go on
// anyone's schedule." A job whose scheduling_status is 'scheduled' but that has
// NO technician assigned is invisible everywhere: it's skipped by the Needs-
// Scheduled queue (looks handled — it says "scheduled") AND it can't render on
// any tech's day (no tech to render against). The classic SquareTrade/AHS
// auto-accept limbo (accept flips status but never routes to a tech).
//
// This scans the newest ~600 'scheduled' jobs and returns every one missing a
// tech, PLUS scheduled jobs whose date is already in the past (a tech is set but
// it fell off "today"). Surface-only — it flags for the office, never assigns.
//
//   GET  /stranded-jobs      -> { ok, count, urgent, jobs:[...] }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }

const first = (r, keys) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); } return ''; };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // Pull the newest jobs in every status that can HIDE an accepted job. Just
  // 'scheduled' missed the worst case: SquareTrade auto-accepts land as
  // 'needs_more_info' (or 'held') WITH a date but no tech — and the board doesn't
  // even render those statuses, so the job was invisible everywhere (Calvin Gibson,
  // 2026-07-13). Scan all three; single-field filter per the metadata search rule.
  let rows = [];
  try {
    for (const st of ['scheduled', 'needs_more_info', 'held']) {
      for (let p = 1; p <= 4; p++) {
        const page = await crud.searchPageN(crud.TABLES.jobs, { scheduling_status: st }, { id: 'desc' }, 100, p);
        if (!page.length) break;
        rows = rows.concat(page);
        if (page.length < 100) break;
      }
    }
  } catch (e) {
    return j(500, { ok: false, error: 'scan_failed', detail: String(e && e.message || e) });
  }

  const FRESH_MS = 3 * 86400000;   // "accepted recently, not yet routed" window
  const now = Date.now();
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue; seen.add(r.id);   // de-dupe across the status scans
    const tid = Number(r.technician_id || 0) || 0;
    if (tid) continue;                              // only NO-TECH jobs can vanish off every day
    const st = String(r.scheduling_status || ''); const cst = String(r.current_status || '');
    if (/cancel|complete/i.test(st) || /cancel|complete/i.test(cst)) continue;
    const ssn = Number(r.scheduled_start || 0) || 0;
    // A date only counts as "urgent" if it's NEAR-TERM (a real current appointment).
    // Ancient dated shells (old SquareTrade stubs) don't fire the alarm — they're
    // backlog, treated as no-date below.
    const hasDate = !!ssn && ssn > (now - 5 * 86400000) && ssn < (now + 21 * 86400000);
    const ss = ssn;
    const created = Number(r.created_at || 0) || 0;
    const fresh = created && (now - created) < FRESH_MS;
    // A no-tech job WITH a date = a real appointment nobody's assigned to (the fire).
    // A no-tech job with NO date but accepted in the last 3 days = a fresh accept not
    // yet routed. Skip the ancient no-date "scheduled" shells (~200 dead warranty
    // stubs) — that's a separate backlog cleanup, not a daily safety alarm.
    if (!hasDate && !fresh) continue;

    const urgent = hasDate;
    const reason = hasDate ? 'has a date but NO tech assigned' : 'accepted — not yet routed to a tech';

    const name = `${first(r, ['customer_first', 'customer_first_name'])} ${first(r, ['customer_last', 'customer_last_name'])}`.trim();
    out.push({
      job_id: r.id,
      customer: name || '(no name)',
      phone: first(r, ['customer_phone', 'phone']),
      zip: first(r, ['service_zip', 'zip']),
      state: first(r, ['service_state', 'state']),
      vendor: first(r, ['warranty_company']),
      appliance: first(r, ['appliance_type']),
      scheduled_start: ss || null,
      technician_id: tid || null,
      created_at: Number(r.created_at || 0) || null,
      reason, urgent,
    });
  }

  // Most urgent first: has-a-date-no-tech, newest/upcoming date first (a job dated
  // today or in the future — nobody assigned — beats a month-old shell). Then the
  // fresh no-date accepts, newest first.
  out.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if (a.urgent && b.urgent) return (b.scheduled_start || 0) - (a.scheduled_start || 0);
    return (b.created_at || 0) - (a.created_at || 0);
  });

  return j(200, { ok: true, count: out.length, urgent: out.filter((x) => x.urgent).length, scanned: rows.length, jobs: out });
};
