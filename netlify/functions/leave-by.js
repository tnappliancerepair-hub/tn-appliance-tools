// leave-by — the customer's "I have to leave by ___ / not available after ___"
// time. Teddy 2026-08-11: techs + office asked to SEE what time a customer has to
// leave so a stop never gets missed because the customer had to run. Danielle sets
// it on the board; it shows as a bold chip on the board tile AND on the tech's
// daily stop. Stored as an event_log 'customer_leave_by' row (latest wins) so it's
// durable + readable everywhere with zero schema change.
//
//   POST { job_id, leave_by, by? }   -> { ok }            (leave_by:"" clears it)
//   GET  ?job_id=123                 -> { ok, leave_by }
//   GET  ?job_ids=1,2,3              -> { ok, by_job:{ "1":"2:00 PM", ... } }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

exports.config = { timeout: 20 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  // ── WRITE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const t = process.env.XANO_METADATA_TOKEN;
    if (!t) return json(500, { ok: false, error: 'metadata token not configured' });
    let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }
    const jobId = Number(b.job_id || b.jobId || 0);
    if (!jobId) return json(400, { ok: false, error: 'job_id required' });
    const leaveBy = String(b.leave_by == null ? '' : b.leave_by).trim().slice(0, 60);
    const by = String(b.by || 'office').slice(0, 40);
    try {
      const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'customer_leave_by', metadata: { job_id: jobId, leave_by: leaveBy, by, at_ms: Date.now() } }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) { const tx = await r.text().catch(() => ''); throw new Error('event_log ' + r.status + ' ' + tx.slice(0, 120)); }
      return json(200, { ok: true, job_id: jobId, leave_by: leaveBy });
    } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  }

  // ── READ ─────────────────────────────────────────────────────────────────
  const q = event.queryStringParameters || {};
  const daysBack = Math.max(1, Math.min(180, parseInt(q.days_back, 10) || 90));
  let ids = [];
  if (q.job_id) ids = [parseInt(q.job_id, 10)].filter(Boolean);
  else if (q.job_ids) ids = String(q.job_ids).split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  const idset = new Set(ids.map(Number));

  let rows = [];
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=customer_leave_by&days_back=${daysBack}&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    rows = (d && (d.items || d.rows)) || [];
  } catch (_) { rows = []; }

  // Latest write per job wins (a later blank clears it).
  const latest = {}; // jid -> {at, leave_by}
  for (const row of rows) {
    const m = asObj(row.metadata);
    const jid = Number(m.job_id || 0);
    if (!jid || (idset.size && !idset.has(jid))) continue;
    const at = Number(row.created_at) || Number(m.at_ms) || 0;
    if (!latest[jid] || at > latest[jid].at) latest[jid] = { at, leave_by: String(m.leave_by || '').trim() };
  }

  const byJob = {};
  for (const k in latest) { if (latest[k].leave_by) byJob[k] = latest[k].leave_by; }

  if (q.job_id) { const jid = ids[0]; return json(200, { ok: true, job_id: jid, leave_by: byJob[jid] || '' }); }
  return json(200, { ok: true, by_job: byJob });
};
