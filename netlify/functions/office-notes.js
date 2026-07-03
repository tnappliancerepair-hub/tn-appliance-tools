// office-notes — the office's per-job notes TO the tech (parts pickup, upsells
// like a hose to sell, special instructions). Danielle writes them on the job
// (save-office-note -> event_log 'office_note'); the tech reads them on his job
// and across his whole day. (Teddy 2026-07-03)
//
//   GET ?job_id=123     -> { ok, job_id, notes:[{text,by,ts}], seen:{at,by}|null }
//   GET ?job_ids=1,2,3  -> { ok, by_job:{"1":[...]}, seen_by_job:{"1":{at,by}} }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }
async function events(action, daysBack) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${action}&days_back=${daysBack}&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    return (d && (d.items || d.rows)) || [];
  } catch (_) { return []; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const daysBack = Math.max(1, Math.min(180, parseInt(q.days_back, 10) || 60));
  let ids = [];
  if (q.job_id) ids = [parseInt(q.job_id, 10)].filter(Boolean);
  else if (q.job_ids) ids = String(q.job_ids).split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  const idset = new Set(ids.map(Number));

  const [noteRows, seenRows] = await Promise.all([events('office_note', daysBack), events('office_note_seen', daysBack)]);

  const byJob = {};
  for (const row of noteRows) {
    const m = asObj(row.metadata);
    const jid = Number(m.job_id || 0);
    if (!jid || (idset.size && !idset.has(jid))) continue;
    const text = String(m.text || '').trim();
    if (!text) continue;
    (byJob[jid] = byJob[jid] || []).push({ text, by: String(m.by || 'office'), ts: Number(row.created_at) || Number(m.at_ms) || 0 });
  }
  for (const k in byJob) byJob[k].sort((a, b) => a.ts - b.ts);

  // Latest "seen" per job (newest read receipt wins).
  const seenByJob = {};
  for (const row of seenRows) {
    const m = asObj(row.metadata);
    const jid = Number(m.job_id || 0);
    if (!jid || (idset.size && !idset.has(jid))) continue;
    const at = Number(row.created_at) || Number(m.at_ms) || 0;
    if (!seenByJob[jid] || at > seenByJob[jid].at) seenByJob[jid] = { at, by: String(m.tech || m.by || '') };
  }

  if (q.job_id) { const jid = ids[0]; return json(200, { ok: true, job_id: jid, notes: byJob[jid] || [], seen: seenByJob[jid] || null }); }
  return json(200, { ok: true, by_job: byJob, seen_by_job: seenByJob });
};
