// cancel-request — a tech taps "🚫 Cancel this job" on his completion screen and tells
// us, in his own words, what's going on. This logs a `cancel_requested` marker so the
// office board flags the job with a BLUE siren; the office reviews it (invoice a trip fee
// if owed?) and cancels it out from there. (Teddy 2026-07-16, option 5.)
//
//   POST { job_id, technician_id, reason }  -> log the marker
//   GET                                     -> { ok, by_job:{"123":{reason,by,ts}} }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

exports.handler = async function (event) {
  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    const jobId = parseInt(b.job_id, 10);
    if (!jobId) return json(400, { ok: false, error: 'job_id required' });
    try {
      await crud.logEvent('cancel_requested', {
        job_id: jobId, technician_id: b.technician_id || 0,
        reason: String(b.reason || '').slice(0, 500), at_ms: Date.now(),
      });
    } catch (_) { return json(200, { ok: false, error: 'log failed' }); }
    return json(200, { ok: true, job_id: jobId });
  }

  // GET — markers for the board.
  const daysBack = 90;
  let rows = [];
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=cancel_requested&days_back=${daysBack}&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    rows = (d && (d.items || d.rows)) || [];
  } catch (_) { rows = []; }
  const latest = {};
  for (const row of rows) {
    const m = asObj(row.metadata);
    const jid = Number(m.job_id || 0); if (!jid) continue;
    const at = Number(row.created_at) || Number(m.at_ms) || 0;
    if (!latest[jid] || at > latest[jid].ts) latest[jid] = { reason: String(m.reason || '').slice(0, 300), by: String(m.by || m.technician_id || ''), ts: at };
  }
  return json(200, { ok: true, by_job: latest });
};
