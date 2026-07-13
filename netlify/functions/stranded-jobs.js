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

// CT midnight (start of today) in ms — used to detect past-dated scheduled jobs.
function ctMidnightMs() {
  const now = new Date();
  // America/Chicago offset: CDT = UTC-5 in July. Use Intl to be DST-correct.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  // midnight CT for that calendar day, expressed as a UTC instant
  return Date.parse(`${y}-${m}-${d}T00:00:00-05:00`);
}

const first = (r, keys) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); } return ''; };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // Pull the newest scheduled jobs (single-field filter — metadata search rule).
  let rows = [];
  try {
    for (let p = 1; p <= 6; p++) {
      const page = await crud.searchPageN(crud.TABLES.jobs, { scheduling_status: 'scheduled' }, { id: 'desc' }, 100, p);
      if (!page.length) break;
      rows = rows.concat(page);
      if (page.length < 100) break;
    }
  } catch (e) {
    return j(500, { ok: false, error: 'scan_failed', detail: String(e && e.message || e) });
  }

  const todayMs = ctMidnightMs();
  const out = [];
  for (const r of rows) {
    const tid = Number(r.technician_id || 0) || 0;
    const ss = Number(r.scheduled_start || 0) || 0;
    const noTech = !tid;
    const pastDate = tid && ss && ss < todayMs;   // has a tech but scheduled to a past day
    if (!noTech && !pastDate) continue;             // properly scheduled — skip

    let reason, urgent = false;
    if (noTech && !ss) { reason = 'accepted — never routed to a tech'; }
    else if (noTech && ss) { reason = 'has a date but NO tech assigned'; urgent = true; }
    else { reason = 'scheduled to a past date'; }

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

  // Most urgent first: has-a-date-no-tech (soonest date), then never-routed (newest),
  // then past-date.
  out.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if (a.urgent && b.urgent) return (a.scheduled_start || 0) - (b.scheduled_start || 0);
    return (b.created_at || 0) - (a.created_at || 0);
  });

  return j(200, { ok: true, count: out.length, urgent: out.filter((x) => x.urgent).length, scanned: rows.length, jobs: out });
};
