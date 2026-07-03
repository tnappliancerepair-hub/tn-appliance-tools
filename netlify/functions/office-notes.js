// office-notes — the office's per-job notes TO the tech (parts pickup, upsells
// like a hose to sell, special instructions). Danielle writes them on the job
// (save-office-note -> event_log 'office_note'); the tech reads them on his job
// and across his whole day. (Teddy 2026-07-03)
//
//   GET ?job_id=123                 -> { ok, job_id, notes:[{text,by,ts}] }  (one job, oldest->newest)
//   GET ?job_ids=1,2,3              -> { ok, by_job:{ "1":[...], "2":[...] } } (dashboard aggregate)
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const daysBack = Math.max(1, Math.min(180, parseInt(q.days_back, 10) || 60));
  let ids = [];
  if (q.job_id) ids = [parseInt(q.job_id, 10)].filter(Boolean);
  else if (q.job_ids) ids = String(q.job_ids).split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  const idset = new Set(ids.map(Number));

  let rows = [];
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=office_note&days_back=${daysBack}&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    rows = (d && (d.items || d.rows)) || [];
  } catch (_) {}

  const byJob = {};
  for (const row of rows) {
    const m = asObj(row.metadata);
    const jid = Number(m.job_id || 0);
    if (!jid) continue;
    if (idset.size && !idset.has(jid)) continue;
    const text = String(m.text || '').trim();
    if (!text) continue;
    (byJob[jid] = byJob[jid] || []).push({ text, by: String(m.by || 'office'), ts: Number(row.created_at) || Number(m.at_ms) || 0 });
  }
  for (const k in byJob) byJob[k].sort((a, b) => a.ts - b.ts);

  if (q.job_id) { const jid = ids[0]; return json(200, { ok: true, job_id: jid, notes: byJob[jid] || [] }); }
  return json(200, { ok: true, by_job: byJob });
};
