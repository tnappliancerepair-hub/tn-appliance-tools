// game-grade — "Beat the Boss" 🎮 payoff. Once reality is known (the finished
// report's real failed component / verified part), grade the tech's and Teddy's
// locked-in guesses and fire the celebration: 🎉 big win when the tech beats the
// boss, 😈 "the boss wins again" evil-laugh when they lose. Idempotent per job.
//
//   POST { job_id, real_component?, real_part?, force? }  -> { ok, graded, result }
//        (real_* optional — pulled from get_unified_tdr_status when omitted)
//   GET  ?scoreboard=1   -> { boss_wins, tech_wins, ties, none, techs:[...], recent:[...] }
'use strict';

const { sendSms } = require('./_lib/sms');
const { ID_PHONE } = require('./_lib/area-tech-notify');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

const partNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function partsEqual(a, b) { const x = partNorm(a), y = partNorm(b); if (!x || !y) return false; if (x === y) return true; return x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x)); }
function compMatch(a, b) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const x = norm(a), y = norm(b); if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const tok = (s) => s.split(' ').filter((w) => w.length >= 4);
  return tok(x).some((w) => tok(y).includes(w));
}
function correct(guess, realComp, realPart) {
  if (!guess) return false;
  if (partsEqual(guess.part, realPart)) return true;
  return compMatch(guess.component, realComp);
}

async function eventRows(action) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${action}&days_back=365&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json(); return (d && (d.items || d.rows)) || [];
  } catch (_) { return []; }
}
async function record(action, metadata) {
  try { await fetch(`${XANO}/record_event_log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, metadata_json: JSON.stringify(metadata) }) }); } catch (_) {}
}
async function guessesFor(jobId) {
  const rows = await eventRows('beat_boss_guess');
  const latest = { tech: null, teddy: null };
  for (const row of rows) {
    const m = asObj(row.metadata); if (Number(m.job_id) !== Number(jobId)) continue;
    const who = m.who === 'teddy' ? 'teddy' : 'tech';
    const at = Number(row.created_at) || Number(m.at_ms) || 0;
    if (!latest[who] || at > latest[who].at) latest[who] = { who, tech_id: m.tech_id || 0, name: m.name || '', component: m.component || '', part: m.part || '', at };
  }
  return latest;
}
async function realAnswer(jobId) {
  try {
    const r = await fetch(`${XANO}/get_unified_tdr_status?job_id=${jobId}`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json(); const f = (d && d.fields) || {};
    const comp = (f.failed_component && f.failed_component.value) || d.failed_component || '';
    const part = d.verified_part_number || (f.verified_part_number && f.verified_part_number.value) || (f.part_number && f.part_number.value) || '';
    return { component: String(comp || ''), part: String(part || '') };
  } catch (_) { return { component: '', part: '' }; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // ── Scoreboard ──
  if (event.httpMethod === 'GET' && (event.queryStringParameters || {}).scoreboard) {
    const rows = await eventRows('beat_boss_result');
    let boss = 0, tech = 0, ties = 0, none = 0; const perTech = {}; const recent = [];
    const seen = new Set();
    rows.sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
    for (const row of rows) {
      const m = asObj(row.metadata); const jid = Number(m.job_id); if (seen.has(jid)) continue; seen.add(jid);
      if (jid >= 800000) continue; // 800000+ = demo/test jobs, kept out of the real tally
      const tc = !!m.tech_correct, yc = !!m.teddy_correct;
      const nm = m.tech_name || ('Tech ' + (m.tech_id || '?'));
      perTech[nm] = perTech[nm] || { name: nm, wins: 0, losses: 0 };
      if (tc && yc) { ties++; perTech[nm].wins++; }
      else if (tc) { tech++; perTech[nm].wins++; }
      else if (yc) { boss++; perTech[nm].losses++; }
      else { none++; }
      if (recent.length < 20) recent.push({ job_id: jid, winner: m.winner, real: m.real_component || m.real_part, tech: nm, at: Number(row.created_at) || m.at_ms });
    }
    return j(200, { ok: true, boss_wins: boss, tech_wins: tech, ties, none, techs: Object.values(perTech).sort((a, b) => b.wins - a.wins), recent });
  }

  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || 0);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  // Idempotent — grade a job only once (unless force).
  if (!b.force) {
    const prior = await eventRows('beat_boss_result');
    if (prior.some((r) => Number(asObj(r.metadata).job_id) === jobId)) return j(200, { ok: true, graded: false, reason: 'already_graded' });
  }

  const g = await guessesFor(jobId);
  if (!g.tech && !g.teddy) return j(200, { ok: true, graded: false, reason: 'no_guesses' });

  let real = { component: String(b.real_component || ''), part: String(b.real_part || '') };
  if (!real.component && !real.part) real = await realAnswer(jobId);
  if (!real.component && !real.part) return j(200, { ok: true, graded: false, reason: 'no_real_answer_yet' });

  const techCorrect = correct(g.tech, real.component, real.part);
  const teddyCorrect = correct(g.teddy, real.component, real.part);
  let winner = 'none';
  if (techCorrect && teddyCorrect) winner = 'both';
  else if (techCorrect) winner = 'tech';
  else if (teddyCorrect) winner = 'teddy';

  const realStr = [real.component, real.part].filter(Boolean).join(' · ') || 'the fix';
  const result = { job_id: jobId, real_component: real.component, real_part: real.part, tech_name: (g.tech && g.tech.name) || '', tech_id: (g.tech && g.tech.tech_id) || 0, tech_component: g.tech && g.tech.component, tech_part: g.tech && g.tech.part, teddy_component: g.teddy && g.teddy.component, teddy_part: g.teddy && g.teddy.part, tech_correct: techCorrect, teddy_correct: teddyCorrect, winner, at_ms: Date.now() };
  await record('beat_boss_result', result);

  // ── Celebration / evil-laugh ──
  const techPhone = (g.tech && ID_PHONE[g.tech.tech_id]) || '';
  const techName = (g.tech && g.tech.name) || 'The tech';
  let techMsg = '', bossMsg = '';
  if (winner === 'tech') {
    techMsg = '🎉🎉 YOU BEAT THE BOSS! Job #' + jobId + ' was ' + realStr + ' — you called it, Teddy missed it. 🏆 That\'s a W on the board!';
    bossMsg = '😳 ' + techName + ' beat you on #' + jobId + ' — it was ' + realStr + '. They\'re coming for the crown. 👑';
  } else if (winner === 'both') {
    techMsg = '🎉 You AND the boss both nailed #' + jobId + ' (' + realStr + '). Respect — the machine can\'t tell you apart. 🤝';
    bossMsg = '🤝 Dead heat on #' + jobId + ' — you + ' + techName + ' both got ' + realStr + '. Sharp crew.';
  } else if (winner === 'teddy') {
    techMsg = '😈 THE BOSS WINS AGAIN. #' + jobId + ' was ' + realStr + ' — Teddy had it, you didn\'t. mwahahaha 🔥 Get him next time.';
    bossMsg = '😈👑 BOSS WINS AGAIN! #' + jobId + ' was ' + realStr + '. ' + techName + ' guessed wrong, you nailed it. *evil laugh*';
  } else {
    techMsg = '🤷 Reality stumped you both on #' + jobId + ' — it was ' + realStr + '. Rematch on the next one.';
    bossMsg = '🤷 #' + jobId + ' got you both — it was ' + realStr + '. Nobody\'s crown today.';
  }
  if (techPhone && (winner === 'tech' || winner === 'both' || winner === 'teddy' || winner === 'none')) { try { await sendSms(techPhone, techMsg, 'technician', 'beat_boss_result'); } catch (_) {} }
  try { await sendSms(OWNER, bossMsg, 'owner', 'beat_boss_result'); } catch (_) {}

  return j(200, { ok: true, graded: true, result });
};
