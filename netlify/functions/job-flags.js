// job-flags — lightweight per-job flags WITHOUT a Mac/XS push. Persists two
// scheduling flags via event_log breadcrumbs (same pattern as office-stage):
//   • two_man        — this job needs TWO people (heavy unit, tight space, etc.)
//   • time_consuming  — this job eats the day; give it extra room on the route.
//
// These are FLAGS for scheduling, not a crew assignment. crew.js assigns a
// specific 2nd tech (accepted_by_tech_id) so a two-man job shows on both
// dashboards; this is the upstream signal a tech or the office raises so the
// office knows to route a helper + block extra time. Both can be used together.
//
//   POST { job_id, flag:'two_man'|'time_consuming', on:true|false, actor }
//        -> reads the latest state, flips the one flag, writes merged state
//   POST { job_id, two_man, time_consuming, actor }  (explicit full state)
//   GET                     -> { ok, flags: { <id>: {two_man, time_consuming} } }
//   GET ?job_id=N           -> { ok, job_id, two_man, time_consuming }
//
// Runs open like the other board endpoints (Metadata token stays server-side;
// the office board + tech app are already gated).
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const EVENT_LOG_TABLE = 3;
const ACTION = 'job_flag_set';

function jres(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

// Latest flag state for ONE job, scanning deeper than the global window so a
// job's flags are never dropped just because a busy board pushed them out.
async function latestForJob(jobId) {
  for (let page = 1; page <= 6; page++) {
    const rows = await crud.searchPageN(EVENT_LOG_TABLE, { action: ACTION }, { created_at: 'desc' }, 500, page);
    for (const r of rows) {
      let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } m = m || {};
      if (parseInt(m.job_id, 10) !== jobId) continue;
      return { two_man: !!m.two_man, time_consuming: !!m.time_consuming };
    }
    if (rows.length < 500) break;
  }
  return { two_man: false, time_consuming: false };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  try {
    // READ (single job): latest flags, deep scan.
    const qJob = parseInt((event.queryStringParameters || {}).job_id, 10);
    if (event.httpMethod === 'GET' && qJob) {
      const st = await latestForJob(qJob);
      return jres(200, { ok: true, job_id: qJob, two_man: st.two_man, time_consuming: st.time_consuming });
    }

    // READ (all): latest flag state per job from the breadcrumbs (newest wins).
    if (event.httpMethod === 'GET') {
      const rows = await crud.searchPage(EVENT_LOG_TABLE, { action: ACTION }, { created_at: 'desc' }, 400);
      const flags = {};
      for (const r of rows) {
        let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } m = m || {};
        const id = m.job_id;
        if (id == null || flags[id] !== undefined) continue;   // newest wins
        flags[id] = { two_man: !!m.two_man, time_consuming: !!m.time_consuming };
      }
      return jres(200, { ok: true, flags });
    }

    if (event.httpMethod !== 'POST') return jres(405, { ok: false, error: 'Method Not Allowed' });

    const b = JSON.parse(event.body || '{}');
    const jobId = parseInt(b.job_id, 10);
    if (!jobId) return jres(400, { ok: false, error: 'job_id required' });
    const actor = String(b.actor || 'tech');

    let two_man, time_consuming;
    if (b.flag) {
      // Single-flag toggle: read current state, flip the one flag.
      const flag = String(b.flag).toLowerCase();
      if (flag !== 'two_man' && flag !== 'time_consuming') {
        return jres(400, { ok: false, error: 'flag must be two_man or time_consuming' });
      }
      const cur = await latestForJob(jobId);
      two_man = cur.two_man; time_consuming = cur.time_consuming;
      const on = (b.on === true || b.on === 'true' || b.on === 1 || b.on === '1');
      if (flag === 'two_man') two_man = on; else time_consuming = on;
    } else {
      // Explicit full state.
      two_man = !!(b.two_man === true || b.two_man === 'true' || b.two_man === 1 || b.two_man === '1');
      time_consuming = !!(b.time_consuming === true || b.time_consuming === 'true' || b.time_consuming === 1 || b.time_consuming === '1');
    }

    await crud.logEvent(ACTION, { job_id: jobId, two_man, time_consuming, actor });
    return jres(200, { ok: true, success: true, job_id: jobId, two_man, time_consuming });
  } catch (e) {
    return jres(200, { ok: false, success: false, error: String((e && e.message) || e) });
  }
};
