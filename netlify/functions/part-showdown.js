// part-showdown — per-job state for the 🎯 part challenge on the tech tile.
// Returns Danielle's office call (if any) + whether the round is already resolved
// (the tech confirmed/overrode the part). Ant's guess itself comes from
// ant-brain-predict on the tile; the tech's confirm/override posts to
// ant-brain-verdict. This is the cheap read that lets the tile show
// "🐜 Ant said X · 🧑‍💼 Danielle said Y — what's the real part?"
//
//   GET ?job_id=123 -> { ok, job_id, danielle:{part,by}|null, resolved:{part,verdict,tech_id}|null }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT = 3;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ms(x) { return x ? (typeof x === 'number' ? x : Date.parse(x)) : 0; }

async function latestForJob(action, jobId) {
  try {
    const r = await fetch(`${META}/table/${EVENT}/content/search`, {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 300, page: 1 }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const rows = ((await r.json()).items) || [];
    let best = null, bestAt = -1;
    for (const row of rows) {
      const m = metaOf(row);
      if (Number(m.job_id || 0) !== jobId) continue;
      const at = ms(m.at_ms) || ms(row.created_at);
      if (at > bestAt) { bestAt = at; best = m; }
    }
    return best;
  } catch (_) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  const jobId = parseInt((event.queryStringParameters || {}).job_id, 10);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  let dcall = null, verdict = null;
  try { [dcall, verdict] = await Promise.all([latestForJob('danielle_part_call', jobId), latestForJob('ant_brain_verdict', jobId)]); }
  catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  const danielle = (dcall && String(dcall.part || '').trim())
    ? { part: String(dcall.part).trim(), by: String(dcall.by || 'Danielle') } : null;
  const resolved = (verdict && String(verdict.part || '').trim())
    ? { part: String(verdict.part).trim(), verdict: String(verdict.verdict || 'confirmed'), tech_id: Number(verdict.technician_id || 0) || null, beat_ant: !!verdict.beat_ant, ant_part: String(verdict.ant_part || '').trim(), ant_component: String(verdict.ant_component || '') } : null;

  return j(200, { ok: true, job_id: jobId, danielle, resolved });
};
