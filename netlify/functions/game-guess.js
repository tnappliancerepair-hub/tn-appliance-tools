// game-guess — "Beat the Boss" 🎮 lock-in. When a new job's Teddy Tool goes to the
// area tech, the tech locks in their diagnosis (failed component + part #) BEFORE
// Teddy. Teddy locks his own, independently. If they picked the SAME → instant
// CONFIRMED (the tech wins — the boss agrees). If different, both answers are
// locked and reality (the finished report) settles it later (game-grade.js).
//
//   POST { job_id, who:'tech'|'teddy', tech_id?, name?, component?, part? }
//        -> { ok, locked, mine, other, match, confirmed }
//   GET  ?job_id=N   -> { tech, teddy, match, confirmed, result }
//
// State = latest-wins event_log markers ('beat_boss_guess'), no schema change.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

const partNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function partsEqual(a, b) {
  const x = partNorm(a), y = partNorm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x));
}
function compMatch(a, b) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const tok = (s) => s.split(' ').filter((w) => w.length >= 4);
  const tx = tok(x), ty = tok(y);
  return tx.some((w) => ty.includes(w));
}
// A match = the strong signal (part #) OR the component agreeing.
function guessesMatch(g1, g2) {
  if (!g1 || !g2) return false;
  if (partsEqual(g1.part, g2.part)) return true;
  return compMatch(g1.component, g2.component);
}

async function loadState(jobId) {
  let rows = [];
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=beat_boss_guess&days_back=365&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    rows = (d && (d.items || d.rows)) || [];
  } catch (_) {}
  const latest = { tech: null, teddy: null };
  for (const row of rows) {
    const m = asObj(row.metadata); if (Number(m.job_id) !== Number(jobId)) continue;
    const who = m.who === 'teddy' ? 'teddy' : 'tech';
    const at = Number(row.created_at) || Number(m.at_ms) || 0;
    if (!latest[who] || at > latest[who].at) latest[who] = { who, tech_id: m.tech_id || 0, name: m.name || '', component: m.component || '', part: m.part || '', at };
  }
  // grade result if one exists
  let result = null;
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=beat_boss_result&days_back=365&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    const rr = (d && (d.items || d.rows)) || [];
    for (const row of rr) { const m = asObj(row.metadata); if (Number(m.job_id) === Number(jobId)) { const at = Number(row.created_at) || Number(m.at_ms) || 0; if (!result || at > result._at) { result = { ...m, _at: at }; } } }
  } catch (_) {}
  const match = guessesMatch(latest.tech, latest.teddy);
  return { tech: latest.tech, teddy: latest.teddy, match, confirmed: match && latest.tech && latest.teddy, result };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  if (event.httpMethod === 'GET') {
    const jobId = Number((event.queryStringParameters || {}).job_id || 0);
    if (!jobId) return j(400, { ok: false, error: 'job_id required' });
    const st = await loadState(jobId);
    return j(200, { ok: true, ...st });
  }

  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || 0);
  const who = b.who === 'teddy' ? 'teddy' : 'tech';
  const component = String(b.component || '').trim().slice(0, 120);
  const part = String(b.part || '').trim().slice(0, 60);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  if (!component && !part) return j(400, { ok: false, error: 'lock in a component or part #' });

  const marker = { job_id: jobId, who, tech_id: Number(b.tech_id) || 0, name: String(b.name || '').slice(0, 40), component, part, at_ms: Date.now() };
  try {
    await fetch(`${XANO}/record_event_log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'beat_boss_guess', metadata_json: JSON.stringify(marker) }) });
  } catch (e) { return j(200, { ok: false, error: 'could not lock in — try again' }); }

  const st = await loadState(jobId);
  const mine = st[who];
  const other = who === 'tech' ? st.teddy : st.tech;
  return j(200, { ok: true, locked: true, mine, other, match: st.match, confirmed: st.confirmed });
};
