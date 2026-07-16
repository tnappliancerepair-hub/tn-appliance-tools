// second-opinions — jobs a tech passed off for a SECOND OPINION (couldn't fix it;
// office uploads to the warranty company for a 2nd opinion). The tech's "🙋 Pass off
// — 2nd opinion" completion logs a `second_opinion_requested` event; the office board
// reads this to flag those jobs with an ORANGE siren (vs the RED replacement siren).
// (Teddy 2026-07-16, option 4.) Mirrors office-notes.js.
//
//   GET            -> { ok, by_job:{"123":{reason,by,ts}} }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const daysBack = Math.max(1, Math.min(180, parseInt(q.days_back, 10) || 90));
  let rows = [];
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=second_opinion_requested&days_back=${daysBack}&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    rows = (d && (d.items || d.rows)) || [];
  } catch (_) { rows = []; }

  // A job leaves the second-opinion state once it's resolved (office reassigned /
  // uploaded it, or it completed). Newest event per job wins; a `second_opinion_resolved`
  // clears it.
  const latest = {};
  for (const row of rows) {
    const m = asObj(row.metadata);
    const jid = Number(m.job_id || 0); if (!jid) continue;
    const at = Number(row.created_at) || Number(m.at_ms) || 0;
    if (!latest[jid] || at > latest[jid].ts) latest[jid] = { reason: String(m.reason || '').slice(0, 300), by: String(m.by || m.technician_id || ''), ts: at };
  }
  return json(200, { ok: true, by_job: latest });
};
