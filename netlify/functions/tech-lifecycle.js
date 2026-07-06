// tech-lifecycle — the return-visit-safe proxy for the tech's "On my way" / "Start"
// buttons. Fixes: 2nd/3rd/4th trips to the same job couldn't send "on the way"
// because tech_on_the_way refuses when tech_en_route_at is already set (and
// tech_job_started when job_started_at is set) — those flags were stamped on the
// FIRST trip and never reset. Every return visit locked to "tap to retry".
//
// The rule (Teddy 7/6: "every 2nd/3rd/4th trip has to say we're on the way"):
//   • If the en-route / started stamp is from a PRIOR calendar day (America/Chicago),
//     it's a previous trip → clear it so THIS trip starts fresh, then fire the action
//     (customer gets a fresh "on the way" text every visit).
//   • If the stamp is from TODAY, it's the current visit → leave it, so a repeat tap
//     doesn't double-text the customer (Xano returns "already sent"; we surface that
//     as a friendly ✓ instead of an error).
//
//   POST { job_id, technician_id, action, eta_minutes?, eta_timestamp_ms?, eta_time_str? }
//     action ∈ { tech_on_the_way, tech_job_started }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const TABLES = crud.TABLES;
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ALLOWED = new Set(['tech_on_the_way', 'tech_job_started']);

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: JSON.stringify(b) }; }
// YYYY-MM-DD in America/Chicago (day-granularity so an early "on my way" the same
// morning isn't mistaken for a prior trip).
function ctDay(ms) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(ms))); } catch (_) { return ''; } }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id || 0, 10);
  const techId = parseInt(b.technician_id || 0, 10);
  const action = String(b.action || '');
  if (!jobId || !techId) return j(400, { success: false, error: 'job_id and technician_id required' });
  if (!ALLOWED.has(action)) return j(400, { success: false, error: 'bad action' });

  // 1) Look at the job's current lifecycle stamps; clear any from a PRIOR day so a
  //    return trip starts clean. Best-effort — if the read fails we still proxy.
  try {
    const job = await crud.searchOne(TABLES.jobs, { id: jobId });
    if (job) {
      const today = ctDay(Date.now());
      const er = Number(job.tech_en_route_at) || 0;
      const st = Number(job.job_started_at) || 0;
      const patch = {};
      if (er > 0 && ctDay(er) !== today) { patch.tech_en_route_at = null; patch.eta_ms = null; }
      if (st > 0 && ctDay(st) !== today) { patch.job_started_at = null; }
      if (Object.keys(patch).length) {
        await crud.update(TABLES.jobs, jobId, patch);
        try { await crud.logEvent('lifecycle_return_trip_reset', { job_id: jobId, cleared: Object.keys(patch), action, at_ms: Date.now() }); } catch (_) {}
      }
    }
  } catch (_) { /* proxy anyway */ }

  // 2) Fire the real endpoint (fresh stamps land now → customer gets the text).
  const payload = { job_id: jobId, technician_id: techId };
  if (b.eta_minutes != null) payload.eta_minutes = b.eta_minutes;
  if (b.eta_timestamp_ms != null) payload.eta_timestamp_ms = b.eta_timestamp_ms;
  if (b.eta_time_str) payload.eta_time_str = b.eta_time_str;
  let d = {};
  try {
    const r = await fetch(`${XANO}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    d = await r.json().catch(() => ({}));
  } catch (e) { return j(200, { success: false, error: 'connection error' }); }

  // 3) A same-visit repeat tap ("already sent"/"already started") is harmless — the
  //    customer was already told this trip. Surface it as success so the button reads ✓.
  if (d && d.success === false && /already/i.test(String(d.error || ''))) {
    return j(200, { success: true, already: true, note: d.error });
  }
  return j(200, d && typeof d === 'object' ? d : { success: false, error: 'no response' });
};
