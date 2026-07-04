// warranty-aliases — expose the harvested per-job warranty numbers as a flat
// { number -> job_id } map, so any identifier (SquareTrade claim, ServicePower
// call, extra dispatch #s) resolves to the job. Fed by warranty-id-harvest.
//   GET -> { ok, jobs, count, map: { "<number>": <job_id> } }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

exports.handler = async function () {
  let rows = [];
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=warranty_ids&days_back=400&limit=2000`, { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    rows = (d && (d.items || d.rows)) || [];
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e), map: {} }); }

  // Newest row per job wins; every number in it points to that job.
  const seenJob = new Set();
  const map = {};
  rows.sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
  for (const r of rows) {
    const m = asObj(r.metadata);
    const jid = Number(m.job_id || 0);
    if (!jid || seenJob.has(jid)) continue;
    seenJob.add(jid);
    for (const n of (Array.isArray(m.ids) ? m.ids : [])) { const k = String(n).trim(); if (k && map[k] == null) map[k] = jid; }
  }
  return json(200, { ok: true, jobs: seenJob.size, count: Object.keys(map).length, map });
};
