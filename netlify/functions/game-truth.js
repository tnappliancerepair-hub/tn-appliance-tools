// game-truth — the honest scorekeeper for the part showdown (Teddy 7/5, "kick
// our own ass"). The tech's confirmed part is only a CLAIM until reality settles
// it. This engine grades every round against what actually happened:
//   • LOCKED  — the job proved out (enough time passed, no callback) → points count
//   • PENDING — too new to trust yet → points are provisional
//   • BUSTED  — a callback came back on that customer after the call → the part
//               likely didn't hold → points clawed back, round flagged
//
// It also computes: pioneer 3x for Ant-blind teaches (#4), breakable streaks (#6),
// Danielle-vs-tech head-to-head (#5), Ant's climbing accuracy + what it now
// remembers (#2), the "ones that fooled us" recap (#6), and the integrity audit
// that catches our own rubber-stamps (#7).
//
//   GET ?scope=week|all           -> full board
//   GET ?tech_id=4                -> one tech's settled line
//   GET ?player=danielle          -> Danielle's settled line
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT = 3;
const TECH_NAMES = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
const KEEP = [1, 2, 3, 4, 6];
const SETTLE_DAYS = 10;
const SETTLE_MS = SETTLE_DAYS * 86400000;
// points
const P_CONFIRM = 1, P_BEAT = 3, P_TEACH = 2, P_PIONEER = 6;

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ms(x) { if (x == null || x === '') return 0; if (typeof x === 'number') return x < 1e12 ? x * 1000 : x; const t = Date.parse(x); return isNaN(t) ? 0 : t; }
function pkey(p) { const f = String(p || '').trim().split(/[\s(—\-]/)[0]; return f.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function phone10(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; }
function ctMondayMs() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => +(p.find((x) => x.type === t) || {}).value;
  const y = g('year'), mo = g('month'), d = g('day');
  const probe = new Date(Date.UTC(y, mo - 1, d, 12));
  const back = probe.getUTCDay() === 0 ? 6 : probe.getUTCDay() - 1;
  return Date.UTC(y, mo - 1, d - back, 5, 0, 0);
}
async function rows(action) {
  const out = [];
  try {
    for (let p = 1; p <= 3; p++) {
      const r = await fetch(`${META}/table/${EVENT}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 500, page: p }), signal: AbortSignal.timeout(15000) });
      if (!r.ok) break; const it = ((await r.json()).items) || []; out.push(...it); if (it.length < 500) break;
    }
  } catch (_) {}
  return out;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  const q = event.queryStringParameters || {};
  const cutoff = String(q.scope || '') === 'all' ? 0 : ctMondayMs();
  const now = Date.now();

  let verdicts = [], dcalls = [], preds = [], cbs = [], pipeline = [];
  try {
    [verdicts, dcalls, preds, cbs] = await Promise.all([rows('ant_brain_verdict'), rows('danielle_part_call'), rows('ant_brain_prediction'), rows('callback_request')]);
    try { pipeline = ((await fetch(`${XANO}/list_warranty_pipeline?days_back=60`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json())) || {}).jobs || []; } catch (_) {}
  } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  // ── job index (reality: completion time + phone for callback matching) ──
  const jobIx = {};
  for (const jb of pipeline) jobIx[jb.id] = { completed: ms(jb.job_completed_at), phone: phone10(jb.customer_phone), appliance: jb.appliance_type || '', customer: `${(jb.customer_first || '').trim()} ${(jb.customer_last || '').trim()}`.trim() };
  // callbacks keyed by phone → sorted times
  const cbByPhone = {};
  for (const r of cbs) { const m = metaOf(r); const ph = phone10(m.phone); if (!ph) continue; (cbByPhone[ph] = cbByPhone[ph] || []).push(ms(m.at_ms) || ms(r.created_at)); }
  // Ant's prediction per job (earliest) — for pioneer detection + lock-in time
  const predByJob = {};
  for (const r of preds) { const m = metaOf(r); const jid = Number(m.job_id || 0); if (!jid) continue; const at = ms(m.at_ms) || ms(r.created_at); if (!predByJob[jid] || at < predByJob[jid].at) predByJob[jid] = { at, based_on_n: Number(m.based_on_n || 0), part: m.part }; }
  // Danielle's call per job (latest) with time
  const dByJob = {};
  for (const r of dcalls) { const m = metaOf(r); const jid = Number(m.job_id || 0); if (!jid) continue; const at = ms(m.at_ms) || ms(r.created_at); if (!dByJob[jid] || at > dByJob[jid].at) dByJob[jid] = { part: m.part, at }; }

  function settle(jid, at) {
    const jx = jobIx[jid];
    // callback bust: this customer called back AFTER the tech's call
    if (jx && jx.phone && (cbByPhone[jx.phone] || []).some((t) => t > at)) return 'busted';
    const base = jx && jx.completed ? Math.max(jx.completed, at) : at;
    if (now - base >= SETTLE_MS) return 'locked';
    return 'pending';
  }

  // ── walk the rounds ──
  const per = {}; // tech_id -> tallies
  const rounds = []; // enriched
  let antHits = 0, antMisses = 0, remembered = 0;
  for (const r of verdicts) {
    const m = metaOf(r); const at = ms(m.at_ms) || ms(r.created_at);
    if (cutoff && at && at < cutoff) continue;
    const jid = Number(m.job_id || 0); const tid = Number(m.technician_id || 0);
    const hadGuess = String(m.ant_part || '').trim() !== '';
    const truth = String(m.part || '').trim();
    const status = settle(jid, at);
    let kind, pts;
    if (m.verdict === 'confirmed') { kind = 'confirm'; pts = P_CONFIRM; }
    else if (m.verdict === 'overridden' && hadGuess) { kind = 'beat'; pts = P_BEAT; remembered++; }
    else { const pio = !(predByJob[jid] && predByJob[jid].based_on_n > 0) && !hadGuess; kind = pio ? 'pioneer' : 'teach'; pts = pio ? P_PIONEER : P_TEACH; remembered++; }
    // Ant reality-graded accuracy: a confirm that later BUSTS is actually an Ant miss.
    if (hadGuess) {
      if (kind === 'confirm') { if (status === 'busted') antMisses++; else antHits++; }
      else if (kind === 'beat') { antMisses++; }
    }
    if (tid) {
      const t = per[tid] || (per[tid] = { locked: 0, pending: 0, busted: 0, rounds: 0, confirms: 0, beats: 0, pioneers: 0, _seq: [] });
      t.rounds++;
      if (kind === 'confirm') t.confirms++; else if (kind === 'beat') t.beats++; else if (kind === 'pioneer') t.pioneers++;
      if (status === 'busted') t.busted++;
      else if (status === 'locked') t.locked += pts;
      else t.pending += pts;
      t._seq.push({ at, win: status !== 'busted', status });
    }
    rounds.push({ jid, tid, kind, pts, status, hadGuess, ant_part: m.ant_part || '', truth, at });
  }

  // streaks: consecutive most-recent non-busted rounds (a bust breaks it)
  for (const tid of Object.keys(per)) {
    const seq = per[tid]._seq.sort((a, b) => b.at - a.at); let s = 0;
    for (const x of seq) { if (x.status === 'busted') break; if (x.status === 'locked' || x.status === 'pending') s++; }
    per[tid].streak = s; delete per[tid]._seq;
  }

  // ── Danielle: settled + rivalries vs each tech ──
  const dani = { locked: 0, pending: 0, correct: 0, rounds: 0, busted: 0 };
  const rivalry = {}; // tech_id -> {agreed, disputes, dani_wins, tech_wins}
  const dSeen = new Set();
  let dUngraded = 0;
  for (const r of dcalls) {
    const m = metaOf(r); const at = ms(m.at_ms) || ms(r.created_at);
    if (cutoff && at && at < cutoff) continue;
    const jid = Number(m.job_id || 0); if (!jid || dSeen.has(jid)) continue; dSeen.add(jid);
    // find the resolving verdict for this job
    const v = verdicts.map(metaOf).find((x) => Number(x.job_id || 0) === jid && String(x.part || '').trim());
    dani.rounds++;
    if (!v) { dUngraded++; continue; } // she called it, tech hasn't resolved — she's owed a grade
    const truth = pkey(v.part); const daniHit = pkey(m.part) === truth;
    const status = settle(jid, ms(v.at_ms) || at);
    const tid = Number(v.technician_id || 0);
    const rv = rivalry[tid] || (rivalry[tid] = { agreed: 0, disputes: 0, dani_wins: 0, tech_wins: 0 });
    if (daniHit) { rv.agreed++; if (status !== 'busted') { if (status === 'locked') dani.locked += 3; else dani.pending += 3; dani.correct++; } }
    else { rv.disputes++; if (status === 'busted') { rv.dani_wins++; dani.locked += 2; dani.correct++; } else if (status === 'locked') rv.tech_wins++; }
    if (status === 'busted') dani.busted++;
  }

  // ── Ant climb (reality-graded: a confirm that later busts counts as a miss) ──
  const antAccuracy = (antHits + antMisses) ? Math.round((antHits / (antHits + antMisses)) * 100) : null;

  // ── fooled-us: busted rounds + Ant's live misses ──
  const fooled = rounds.filter((r) => r.status === 'busted' || (r.kind === 'beat')).slice(0, 12)
    .map((r) => ({ job_id: r.jid, who: r.status === 'busted' ? 'callback' : 'ant', ant_part: r.ant_part, real_part: r.truth, customer: (jobIx[r.jid] || {}).customer || '', kind: r.kind, status: r.status }));

  // ── integrity ──
  const rubberStamps = rounds.filter((r) => r.status === 'busted' && r.kind === 'confirm').length;
  const integrity = { rubber_stamps: rubberStamps, ungraded_danielle: dUngraded, busted: rounds.filter((r) => r.status === 'busted').length };

  // ── assemble players ──
  const players = KEEP.map((id) => { const t = per[id] || { locked: 0, pending: 0, busted: 0, rounds: 0, confirms: 0, beats: 0, pioneers: 0, streak: 0 }; return { id: String(id), name: TECH_NAMES[id] || ('Tech ' + id), role: 'tech', locked: t.locked, pending: t.pending, total: t.locked + t.pending, busted: t.busted, streak: t.streak || 0, beats: t.beats, pioneers: t.pioneers, rounds: t.rounds }; });
  players.push({ id: 'danielle', name: 'Danielle', role: 'office', locked: dani.locked, pending: dani.pending, total: dani.locked + dani.pending, busted: dani.busted, correct: dani.correct, rounds: dani.rounds });
  players.sort((a, b) => b.locked - a.locked || b.total - a.total);

  const ant = { accuracy_pct: antAccuracy, hits: antHits, misses: antMisses, remembered, climbing: antAccuracy != null && antAccuracy >= 50 };

  // per-player detail
  if (String(q.player || '') === 'danielle') { const p = players.find((x) => x.id === 'danielle'); return j(200, { ok: true, player: p, ant }); }
  const tid = parseInt(q.tech_id, 10) || 0;
  if (tid) { const p = players.find((x) => x.id === String(tid)); const rv = rivalry[tid] || { agreed: 0, disputes: 0, dani_wins: 0, tech_wins: 0 }; return j(200, { ok: true, player: p, ant, rivalry_vs_danielle: rv }); }

  const rivalries = Object.entries(rivalry).filter(([, v]) => v.agreed + v.disputes > 0).map(([tid, v]) => ({ tech_id: tid, name: TECH_NAMES[tid] || ('Tech ' + tid), ...v })).sort((a, b) => (b.agreed + b.disputes) - (a.agreed + a.disputes));

  return j(200, { ok: true, scope: cutoff ? 'week' : 'all', settle_days: SETTLE_DAYS, ant, players, rivalries, fooled_us: fooled, integrity, scoring: { confirm: P_CONFIRM, beat: P_BEAT, teach: P_TEACH, pioneer: P_PIONEER } });
};
