// propose-schedule-move — the office asks a customer to APPROVE moving their appointment
// to a new day, BEFORE the move is applied (Teddy 2026-08-11). Resolves the customer +
// their current schedule + tech from the job, then hands off to _lib/schedule-move which
// texts the customer and holds the move pending their YES. Nothing is moved here.
//
//   POST { job_id, to_start_ms, tech_id?, by? }   ->  { ok, sent, day }
//   POST { job_id, to_day:"YYYY-MM-DD", ... }      ->  day anchored to 8:00 AM CT
'use strict';
const scheduleMove = require('./_lib/schedule-move');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function ctDayLabel(ms) { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(Number(ms))); } catch (_) { return 'the new day'; } }
// "YYYY-MM-DD" -> ms at 8:00 AM America/Chicago (day-only, matching the no-clock-times model).
function ctDayToMs(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '').trim()); if (!m) return 0;
  // CT is UTC-5 (CDT) most of the year; 8:00 CT ≈ 13:00 UTC. Good enough for a day anchor.
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 13, 0, 0);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }

  const jobId = Number(b.job_id || 0);
  let toStart = Number(b.to_start_ms || 0);
  if (!toStart && b.to_day) toStart = ctDayToMs(b.to_day);
  if (!jobId || !toStart) return j(400, { ok: false, error: 'job_id + to_start_ms (or to_day) required' });

  // Resolve customer + current schedule + tech from the job.
  let d = {};
  try { d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(12000) }).then((r) => r.json()); } catch (_) {}
  const cust = (d && d.customer) || {}, job = (d && d.job) || {}, tk = (d && d.tech) || {}, ap = (d && d.appliance) || {};
  const phone = cust.phone || '';
  if (!phone) return j(200, { ok: false, error: 'no_phone' });
  const techId = Number(b.tech_id || tk.id || job.technician_id || 0);
  const fromStart = Number(job.scheduled_start_ms || 0) || 0;

  const res = await scheduleMove.propose({
    phone, job_id: jobId, cust_id: Number(cust.id || 0), first: cust.first_name || 'there',
    appliance: String(ap.type || job.appliance_type || '').trim(), tech_id: techId,
    tech_first: String((tk.first_name || tk.name || '')).trim().split(/\s+/)[0] || '',
    from_start_ms: fromStart, to_start_ms: toStart, to_day_label: ctDayLabel(toStart), by: String(b.by || 'office'),
  });
  return j(200, res);
};
