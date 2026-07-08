// scoreboard — the crew challenge board (Teddy 2026-07-07: "we need this badly").
// One endpoint, four leaderboards, all from data we already record:
//   🏆 jobs completed      (event_log 'tech_job_complete')
//   📋 TDRs filed          (technician_decision_report rows with real content)
//   💰 upsells / add-on $   (event_log 'addon_fulfilled')
//   🏁 Beat Teddy          (first-to-pre-diagnose per job — Teddy=tech 1 vs the crew,
//                           scored over the current PAY PERIOD; beat Teddy = $100)
//
//   GET /.netlify/functions/scoreboard?scope=today|week|month
//   -> { ok, scope, jobs:[...], tdrs:[...], upsells:[...], beat_teddy:{...} }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT = 3, TDR = 12, TECHS = 15;
const EXCLUDE_TECH = new Set([8]);       // orphan/blank tech row
const OWNER_ID = 1;                       // Teddy

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const nonEmpty = (v) => { const s = String(v == null ? '' : v).trim(); return s !== '' && s.toLowerCase() !== 'null'; };
const rowMs = (r) => { const c = r && r.created_at; const n = (typeof c === 'number') ? c : Date.parse(c) || Number(c) || 0; return n; };

async function metaSearch(tableId, body) {
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (!r.ok) { if (a === 0) continue; return []; }
      return ((await r.json()).items) || [];
    } catch (_) { if (a === 0) continue; return []; }
  }
  return [];
}
async function actionRows(action, pages) {
  const out = [];
  for (let p = 1; p <= (pages || 6); p++) {
    const rows = await metaSearch(EVENT, { search: { action }, sort: { created_at: 'desc' }, per_page: 500, page: p });
    out.push(...rows);
    if (rows.length < 500) break;
  }
  return out;
}

// ── CT window helpers ──────────────────────────────────────────────
function ctYmd(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date(ms));
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return { y: +g('year'), m: +g('month'), d: +g('day'), wd: g('weekday') };
}
// CT is UTC-5 (CDT). Midnight-CT of a Y/M/D as ms.
function ctMidnightMs(y, m, d) { return Date.UTC(y, m - 1, d, 5, 0, 0); }
function startOfTodayMs() { const t = ctYmd(Date.now()); return ctMidnightMs(t.y, t.m, t.d); }
function startOfWeekMs() {
  const now = Date.now(); const t = ctYmd(now);
  const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[t.wd] || 0;
  const back = idx === 0 ? 6 : idx - 1;          // Monday-anchored week
  return startOfTodayMs() - back * 86400000;
}
function startOfMonthMs() { const t = ctYmd(Date.now()); return ctMidnightMs(t.y, t.m, 1); }
// Current pay period (semi-monthly: 1–15, 16–end) — the Beat-Teddy bounty window.
function payPeriodWindow() {
  const t = ctYmd(Date.now());
  if (t.d <= 15) return { start: ctMidnightMs(t.y, t.m, 1), end: Date.now(), label: `${t.m}/1–15` };
  return { start: ctMidnightMs(t.y, t.m, 16), end: Date.now(), label: `${t.m}/16–end` };
}

async function techNames() {
  const rows = await metaSearch(TECHS, { search: {}, sort: { id: 'asc' }, per_page: 100, page: 1 });
  const map = {};
  for (const r of rows) { const id = Number(r.id); if (id) map[id] = (r.first_name || r.name || ('Tech ' + id)).toString().trim(); }
  if (!map[OWNER_ID]) map[OWNER_ID] = 'Teddy';
  return map;
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const scope = ['today', 'week', 'month'].includes(q.scope) ? q.scope : 'today';
    const start = scope === 'month' ? startOfMonthMs() : scope === 'week' ? startOfWeekMs() : startOfTodayMs();
    const end = Date.now();
    const inWin = (ms) => ms >= start && ms <= end;

    const names = await techNames();
    const nameOf = (id) => names[Number(id)] || ('Tech ' + id);
    const isField = (id) => Number(id) > 0 && !EXCLUDE_TECH.has(Number(id));

    // ── 🏆 Jobs completed (dedupe per job_id) ──
    const compRows = await actionRows('tech_job_complete', scope === 'month' ? 8 : 5);
    const jobSeen = new Set(); const jobsByTech = {};
    for (const r of compRows) {
      if (!inWin(rowMs(r))) continue;
      const m = metaOf(r); const tid = Number(m.technician_id || m.tech_id || 0); const jid = Number(m.job_id || 0);
      if (!isField(tid)) continue;
      const key = tid + ':' + (jid || rowMs(r));
      if (jobSeen.has(key)) continue; jobSeen.add(key);
      jobsByTech[tid] = (jobsByTech[tid] || 0) + 1;
    }

    // Job START times — Beat-Teddy only counts a diagnosis filled BEFORE the stop
    // starts (Teddy 2026-07-07: "once it's started, no points"). The whole point is to
    // pre-diagnose the stop so the tech rolls up with the right part = more money.
    const startRows = await actionRows('tech_job_started', 6);
    const jobStartMs = {};
    for (const r of startRows) {
      const m = metaOf(r); const jid = Number(m.job_id || 0); const ms = rowMs(r);
      if (!jid || !ms) continue;
      if (!jobStartMs[jid] || ms < jobStartMs[jid]) jobStartMs[jid] = ms;
    }

    // ── 📋 TDRs filed + 🏁 Beat-Teddy first-fill (both from the TDR table) ──
    const tdrAll = [];
    for (let p = 1; p <= 3; p++) {
      const rows = await metaSearch(TDR, { search: {}, sort: { created_at: 'desc' }, per_page: 500, page: p });
      tdrAll.push(...rows);
      if (rows.length < 500) break;
    }
    const filedInWin = {};          // tech -> Set(job_id) filed in window
    const pp = payPeriodWindow();
    const firstFill = {};           // job_id -> { tid, ms } earliest content-fill in the pay period
    for (const t of tdrAll) {
      const ms = rowMs(t);
      const tid = Number(t.technician_id || 0);
      const jid = Number(t.job_id || 0);
      const hasContent = nonEmpty(t.diagnosis) || nonEmpty(t.repair_completed) || nonEmpty(t.technician_notes) || nonEmpty(t.failed_component) || nonEmpty(t.parts_needed);
      if (!hasContent || !tid) continue;
      // TDRs-filed leaderboard (distinct jobs, field techs only, in the scope window)
      if (isField(tid) && jid && inWin(ms)) { (filedInWin[tid] = filedInWin[tid] || new Set()).add(jid); }
      // Beat-Teddy: earliest PRE-diagnosis per job in the pay period. A fill only
      // counts if it landed BEFORE the stop was started (no points once it's started).
      if (jid && ms >= pp.start && ms <= pp.end && Number(tid) > 0 && !EXCLUDE_TECH.has(Number(tid))) {
        const startedMs = jobStartMs[jid] || 0;
        const isPreDiagnosis = !startedMs || ms < startedMs;
        if (isPreDiagnosis && (!firstFill[jid] || ms < firstFill[jid].ms)) firstFill[jid] = { tid, ms };
      }
    }

    // ── 💰 Upsells / add-on $ (dedupe per job+addon) ──
    const addRows = await actionRows('addon_fulfilled', scope === 'month' ? 6 : 4);
    const addSeen = new Set(); const upByTech = {};
    for (const r of addRows) {
      if (!inWin(rowMs(r))) continue;
      const m = metaOf(r); const tid = Number(m.tech_id || m.technician_id || 0);
      if (!isField(tid)) continue;
      const key = (m.job_id || '') + ':' + (m.addon_key || m.key || m.name || rowMs(r));
      if (addSeen.has(key)) continue; addSeen.add(key);
      const cut = num(m.tech_cut != null ? m.tech_cut : m.cut);
      const u = upByTech[tid] || { cut: 0, count: 0 };
      u.cut += cut; u.count += 1; upByTech[tid] = u;
    }

    // ── assemble leaderboards ──
    const jobs = Object.keys(jobsByTech).map((id) => ({ tech_id: +id, name: nameOf(id), count: jobsByTech[id] })).sort((a, b) => b.count - a.count);
    const tdrs = Object.keys(filedInWin).map((id) => ({ tech_id: +id, name: nameOf(id), count: filedInWin[id].size })).sort((a, b) => b.count - a.count);
    const upsells = Object.keys(upByTech).map((id) => ({ tech_id: +id, name: nameOf(id), cut: Math.round(upByTech[id].cut), count: upByTech[id].count })).sort((a, b) => b.cut - a.cut);

    // Beat Teddy: tally first-fill wins over the pay period.
    const wins = {};
    for (const jid of Object.keys(firstFill)) { const tid = firstFill[jid].tid; wins[tid] = (wins[tid] || 0) + 1; }
    const teddyWins = wins[OWNER_ID] || 0;
    const btTechs = Object.keys(wins).filter((id) => isField(id) && Number(id) !== OWNER_ID).map((id) => ({
      tech_id: +id, name: nameOf(id), wins: wins[id], beating_teddy: wins[id] > teddyWins,
    })).sort((a, b) => b.wins - a.wins);
    const beat_teddy = {
      period: pp.label,
      teddy_wins: teddyWins,
      bounty: 100,
      techs: btTechs,
      leaders: btTechs.filter((t) => t.beating_teddy).map((t) => t.name),
    };

    return j(200, { ok: true, scope, window_start: start, generated_ms: end, jobs, tdrs, upsells, beat_teddy });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
