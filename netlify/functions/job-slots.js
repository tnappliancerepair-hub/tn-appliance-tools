// job-slots — how many scheduling "slots" (stop positions) a job consumes. Most jobs
// take 1; a long/time-consuming job (e.g. a ~3-hr repair) takes 2 or 3 so it fills more
// of a tech's day and he doesn't get over-scheduled. Stored as a latest-wins event_log
// marker (no schema change), same pattern as schedule-hold / office-stage. (Teddy 2026-07-09)
//
//   GET                          -> { ok, slots: { "<job_id>": N, ... } }   (N>1 only)
//   POST { job_id, slots }        -> { ok }   (slots<=1 resets to standard)
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function hdr() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }
async function events(action) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${action}&days_back=180&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    return (d && (d.items || d.rows)) || [];
  } catch (_) { return []; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  if (event.httpMethod === 'GET') {
    const rows = await events('job_slots');
    const latest = {};
    for (const r of rows) {
      const m = asObj(r.metadata); const jid = Number(m.job_id || 0); if (!jid) continue;
      const at = Number(r.created_at) || Number(m.at_ms) || 0;
      const n = Math.max(1, Math.min(8, parseInt(m.slots, 10) || 1));
      if (!latest[jid] || at > latest[jid].at) latest[jid] = { n, at };
    }
    const out = {};
    for (const [jid, v] of Object.entries(latest)) { if (v.n > 1) out[jid] = v.n; }  // only long jobs
    return j(200, { ok: true, slots: out });
  }

  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || 0);
  const slots = Math.max(1, Math.min(8, parseInt(b.slots, 10) || 1));
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  const h = hdr(); if (!h) return j(500, { ok: false, error: 'metadata token not configured' });
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG}/content`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ action: 'job_slots', metadata: { job_id: jobId, slots, by: 'office', at_ms: Date.now() } }),
    });
    if (!r.ok) throw new Error('event_log ' + r.status);
    return j(200, { ok: true, job_id: jobId, slots });
  } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
};
