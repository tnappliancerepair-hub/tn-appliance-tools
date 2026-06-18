// tech-unscheduled.js — surface jobs ASSIGNED to a tech but with NO clock time.
//
// When Danielle assigns a tech on the board, the job saves with technician_id
// but NO scheduled_start — and the tech dashboard's window query filters those
// out, so her work vanishes from the tech's screen ("she schedules in Ant but
// they aren't all there"). The dashboard XS has logic for this, but XS pushes to
// that endpoint have silently no-op'd before, so we don't rely on it.
//
// This is the front-end safety net (mirrors crew.js): it independently pulls a
// tech's untimed, non-terminal jobs straight from the jobs table and the
// dashboard merges them in flagged "no time set." Ships via Netlify, no Mac/XS.
//
//   GET ?tech_id=4   -> { ok, jobs:[{job, customer, untimed:true}], count }
'use strict';

const md = require('./_lib/xano/metadata-crud');
const JOBS = md.TABLES.jobs;          // 7
const CUSTOMER = md.TABLES.customer;  // 6
const TERMINAL = new Set(['canceled', 'cancelled', 'completed', 'no_fix_possible']);

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  try {
    const qp = event.queryStringParameters || {};
    const techId = Number(qp.tech_id);
    if (!techId) return j(400, { ok: false, error: 'tech_id required' });

    // Single-field search (Metadata API ignores multi-field), then filter in JS.
    const rows = await md.searchPage(JOBS, { technician_id: techId }, { created_at: 'desc' }, 200);
    const out = [];
    for (const job of rows || []) {
      if (Number(job.technician_id) !== techId) continue;                  // safety
      const status = String(job.scheduling_status || '').toLowerCase();
      if (TERMINAL.has(status)) continue;                                  // skip done/canceled
      if (Number(job.scheduled_start || 0) > 0) continue;                  // has a time -> already on the dashboard
      if (String(job.test_run_id || '').startsWith('PRACTICE')) continue;  // no practice placements
      let customer = {};
      try { customer = (await md.searchOne(CUSTOMER, { id: Number(job.customer_id) })) || {}; } catch (_) {}
      out.push({ job, customer, untimed: true });
    }
    return j(200, { ok: true, tech_id: techId, count: out.length, jobs: out });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
