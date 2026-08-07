// crew.js — TWO-MAN JOB support.
//
// Ant assigns a job to ONE technician_id, so a job that takes two techs only
// lands on one dashboard. This adds a second ("crew") tech so a two-man job
// shows on BOTH techs' dashboards.
//
// Storage: we reuse the existing jobs.accepted_by_tech_id int column as the
// crew/second-tech slot. It's unused for warranty/HCP jobs (only the broadcast
// flow touches it, which these jobs don't use), so no schema change is needed —
// which means this ships reliably from Netlify with no Mac/XS deploy. When a
// dedicated helper_tech_id column is added later (Xano UI/Mac), swap CREW_FIELD.
//
//   GET  ?action=list&tech_id=4&date=2026-06-17   -> jobs where you're the 2nd tech
//   GET  ?action=get&job_id=123                    -> current 2nd tech on a job
//   POST {action:'set',  job_id, helper_tech_id}  -> mark a job two-man
//   POST {action:'clear',job_id}                  -> remove the 2nd tech
'use strict';

const md = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JOBS = md.TABLES.jobs;          // 7
const CUSTOMER = md.TABLES.customer;  // 6
const CREW_FIELD = 'accepted_by_tech_id';
const ROSTER = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

// CT day window [start, end) in ms for a YYYY-MM-DD date. June = CDT (-05:00).
function ctWindow(dateStr) {
  const start = new Date(`${dateStr}T00:00:00-05:00`).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  try {
    const qp = event.queryStringParameters || {};
    let body = {};
    if (event.body) { try { body = JSON.parse(event.body); } catch (_) {} }
    const action = (body.action || qp.action || 'list').toLowerCase();

    // ── set / clear the second tech ─────────────────────────────────
    if (action === 'set' || action === 'clear') {
      const jobId = Number(body.job_id || qp.job_id);
      if (!jobId) return j(400, { ok: false, error: 'job_id required' });
      const helper = action === 'clear' ? 0 : Number(body.helper_tech_id || qp.helper_tech_id);
      if (action === 'set' && !(helper > 0)) return j(400, { ok: false, error: 'helper_tech_id required' });
      await md.update(JOBS, jobId, { [CREW_FIELD]: helper });
      return j(200, { ok: true, job_id: jobId, helper_tech_id: helper });
    }

    // ── read the current 2nd tech on a job (for the office drawer) ───
    if (action === 'get') {
      const jobId = Number(body.job_id || qp.job_id);
      if (!jobId) return j(400, { ok: false, error: 'job_id required' });
      let job = {};
      try { job = (await md.searchOne(JOBS, { id: jobId })) || {}; } catch (_) {}
      const helper = Number(job[CREW_FIELD]) || 0;
      return j(200, { ok: true, job_id: jobId, helper_tech_id: helper, helper_name: helper ? (ROSTER[helper] || ('Tech ' + helper)) : '' });
    }

    // ── list jobs where this tech is the SECOND man (for the date) ───
    const techId = Number(qp.tech_id || body.tech_id);
    if (!techId) return j(400, { ok: false, error: 'tech_id required' });
    const date = qp.date || body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const { start, end } = ctWindow(date);

    // Single-field search (Metadata API ignores multi-field) then filter in JS.
    const rows = await md.searchPage(JOBS, { [CREW_FIELD]: techId }, { scheduled_start: 'desc' }, 50);
    const out = [];
    for (const job of rows || []) {
      if (Number(job[CREW_FIELD]) !== techId) continue;           // safety
      if (Number(job.technician_id) === techId) continue;         // already your own card
      const ss = Number(job.scheduled_start || 0);
      if (!ss || ss < start || ss >= end) continue;               // not today
      const status = String(job.scheduling_status || '').toLowerCase();
      if (status === 'canceled' || status === 'cancelled') continue;
      let customer = {};
      try { customer = (await md.searchOne(CUSTOMER, { id: Number(job.customer_id) })) || {}; } catch (_) {}
      out.push({ job, customer, crew_with: ROSTER[Number(job.technician_id)] || 'lead tech', is_crew: true });
    }
    out.sort((a, b) => Number(a.job.scheduled_start || 0) - Number(b.job.scheduled_start || 0));
    return j(200, { ok: true, tech_id: techId, date, count: out.length, jobs: out });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
