// ant-brain-game — Stage 2 of Tech vs Ant 🐜 (Teddy 7/5): scoring + points.
//
// Reads the ant_brain_verdict rounds (from Stage 1) and turns them into a game.
// The tech's own call IS the grade at the moment:
//   • CONFIRM   → Ant's guess was right (tech agreed)      → tech +1, Ant a hit
//   • BEAT ANT  → tech overrode a real guess with the truth → tech +3, Ant a miss
//   • TAUGHT    → Ant had no guess, tech supplied the part  → tech +2 (feeds the moat)
// Ant's accuracy = hits / (rounds it actually guessed). That's the number the
// crew tries to beat.
//
//   GET ?scope=week   -> { ok, ant:{accuracy_pct,guesses,hits}, techs:[...ranked by points] }
//   GET ?tech_id=4    -> { ok, tech_id, points, beats, confirms, taught, rounds, rank, rank_total, ant_accuracy_pct }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT = 3;
const TECH_NAMES = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
const KEEP = [1, 2, 3, 4, 6];
const PTS = { confirm: 1, beat: 3, taught: 2 };
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ms(x) { return x ? (typeof x === 'number' ? x : Date.parse(x)) : 0; }
function ctMondayMs() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  const y = +g('year'), mo = +g('month'), d = +g('day');
  const probe = new Date(Date.UTC(y, mo - 1, d, 12));
  const back = (probe.getUTCDay() === 0 ? 6 : probe.getUTCDay() - 1);
  return Date.UTC(y, mo - 1, d - back, 5, 0, 0); // ~CT Monday 00:00
}

async function rowsFor(action) {
  const out = [];
  try {
    for (let p = 1; p <= 4; p++) {
      const r = await fetch(`${META}/table/${EVENT}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 500, page: p }), signal: AbortSignal.timeout(15000) });
      if (!r.ok) break; const rows = ((await r.json()).items) || []; out.push(...rows); if (rows.length < 500) break;
    }
  } catch (_) {}
  return out;
}
// Normalize a part number to its comparable key (leading token, alphanumeric).
function partKey(p) { const first = String(p || '').trim().split(/[\s(—\-]/)[0]; return first.toUpperCase().replace(/[^A-Z0-9]/g, ''); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  const q = event.queryStringParameters || {};
  const cutoff = String(q.scope || '') === 'all' ? 0 : ctMondayMs();

  let verdicts = [], dcalls = [];
  try { [verdicts, dcalls] = await Promise.all([rowsFor('ant_brain_verdict'), rowsFor('danielle_part_call')]); }
  catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  // TRUTH per job = the tech's confirmed part (earliest resolving verdict).
  const truthByJob = {};
  for (const r of verdicts) { const m = metaOf(r); const jid = Number(m.job_id || 0); if (!jid) continue; const k = partKey(m.part); if (!k) continue; const at = ms(m.at_ms) || ms(r.created_at); if (!truthByJob[jid] || at < truthByJob[jid].at) truthByJob[jid] = { key: k, at }; }

  // ── techs (from verdicts, windowed) ──
  const per = {}; let antGuesses = 0, antHits = 0;
  for (const r of verdicts) {
    const m = metaOf(r); const at = ms(m.at_ms) || ms(r.created_at);
    if (cutoff && at && at < cutoff) continue;
    const tid = Number(m.technician_id || 0); if (!tid) continue;
    const t = per[tid] || (per[tid] = { confirms: 0, beats: 0, taught: 0, points: 0, rounds: 0 });
    t.rounds++;
    const hadGuess = String(m.ant_part || '').trim() !== '';
    if (m.verdict === 'confirmed') { t.confirms++; t.points += PTS.confirm; if (hadGuess) { antGuesses++; antHits++; } }
    else if (m.verdict === 'overridden' && hadGuess) { t.beats++; t.points += PTS.beat; antGuesses++; }
    else { t.taught++; t.points += PTS.taught; }
  }
  const antAccuracy = antGuesses ? Math.round((antHits / antGuesses) * 100) : null;

  // ── Danielle (from her calls, windowed) — graded vs the truth ──
  const dani = { correct: 0, calls: 0, beat_tech: 0, points: 0, rounds: 0 };
  const dseen = new Set();
  for (const r of dcalls) {
    const m = metaOf(r); const at = ms(m.at_ms) || ms(r.created_at);
    if (cutoff && at && at < cutoff) continue;
    const jid = Number(m.job_id || 0); if (!jid || dseen.has(jid)) continue; dseen.add(jid); // latest call per job
    dani.calls++; dani.rounds++;
    const truth = truthByJob[jid]; if (!truth) continue; // round not resolved yet
    if (partKey(m.part) === truth.key) { dani.correct++; dani.points += 3; if (at < truth.at) { dani.beat_tech++; dani.points += 2; } }
  }

  // Combined leaderboard: Danielle + the field, one board.
  const players = KEEP.map((id) => { const t = per[id] || { confirms: 0, beats: 0, taught: 0, points: 0, rounds: 0 }; return { id: String(id), name: TECH_NAMES[id] || ('Tech ' + id), role: 'tech', points: t.points, beats: t.beats, confirms: t.confirms, rounds: t.rounds }; });
  players.push({ id: 'danielle', name: 'Danielle', role: 'office', points: dani.points, correct: dani.correct, beat_tech: dani.beat_tech, rounds: dani.rounds });
  players.sort((a, b) => b.points - a.points || (b.beats || b.correct || 0) - (a.beats || a.correct || 0));

  function rankOf(pid) { let rank = 1; for (let i = 0; i < players.length; i++) { if (i > 0 && players[i].points < players[i - 1].points) rank = i + 1; if (players[i].id === String(pid)) return rank; } return players.length; }

  // ── per-player line ──
  if (String(q.player || '') === 'danielle') {
    return j(200, { ok: true, player: 'danielle', points: dani.points, correct: dani.correct, beat_tech: dani.beat_tech, calls: dani.calls, rounds: dani.rounds, rank: rankOf('danielle'), rank_total: players.length, ant_accuracy_pct: antAccuracy });
  }
  const tid = parseInt(q.tech_id, 10) || 0;
  if (tid) {
    const t = per[tid] || { confirms: 0, beats: 0, taught: 0, points: 0, rounds: 0 };
    return j(200, { ok: true, tech_id: tid, points: t.points, beats: t.beats, confirms: t.confirms, taught: t.taught, rounds: t.rounds, rank: rankOf(tid), rank_total: players.length, ant_accuracy_pct: antAccuracy });
  }

  return j(200, { ok: true, scope: cutoff ? 'week' : 'all', ant: { accuracy_pct: antAccuracy, guesses: antGuesses, hits: antHits }, techs: players });
};
