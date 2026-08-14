// ann-call-grader — capture + GRADE Ann's live calls so we can watch the new phone system's
// readiness climb in real numbers (Teddy 2026-08-14). Pulls Telnyx AI conversations, reads each
// transcript, and has Claude score the call (outcome, tool use, brand voice, dead-air, 1-10),
// then rolls the grades into a readiness scorecard.
//
//   (scheduled)                 grade the day's new calls + text Teddy a digest
//   GET ?secret=<admin>&dry=1   grade recent calls, show results, persist NOTHING (preview)
//   GET ?secret=<admin>         grade new calls (skip already-graded) + persist
//   GET ?secret=<admin>&report=1[&days=14]   the readiness SCORECARD (avg score, %resolved, issues)
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const { runBrainTurn, tryParseJsonReply } = require('./_lib/ant/brain-core');

const TELNYX = 'https://api.telnyx.com/v2';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
exports.config = { timeout: 26 };

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function tx(key, path, ms = 12000) { const r = await fetch(`${TELNYX}${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }

const RUBRIC = `You are grading a single phone call handled by "Ann", the AI receptionist for Tennessee Appliance Exchange, to judge how READY the AI phone system is to run live. Read the transcript (Caller / Ann / [tool] turns) and score it.

Return ONLY strict JSON, no prose:
{
 "outcome": one of "booked","scheduling_hold","intake_link_sent","transferred_to_human","callback_taken","answered_question","no_resolution","caller_hung_up","test_call",
 "resolved": true or false (did the caller leave with a clear next step or a real answer),
 "tools_ok": true or false (did Ann use her tools correctly and when needed; false if she should have looked up / sent a link / transferred and didn't, or misfired one),
 "brand_voice_ok": true or false (warm, natural, concise; says "Tennessee Appliance" not "TN"; honest; not robotic or repetitive),
 "dead_air_or_error": true or false (any stall, "hit a snag", tool failure, confusion loop, or the caller having to repeat themselves),
 "issues": [up to 3 short phrases naming what went wrong or was rough; empty array if clean],
 "score": integer 1-10 (this one call: 10 = flawless, happily let it run live; 6-7 = worked but rough; 1-3 = broke or lost the customer),
 "one_line": "one plain-English sentence summarizing what happened on the call"
}
Grade honestly and only from the transcript. A clean booking, hold, link-send, or warm human transfer is 8-10. A stall, a missed tool, a repeat-yourself loop, or a confused caller is 3-6.`;

function transcriptOf(msgs) {
  // messages come newest-first — reverse to chronological
  const ordered = msgs.slice().reverse();
  const lines = [];
  for (const m of ordered) {
    const role = String(m.role || '').toLowerCase();
    const who = role === 'assistant' ? 'Ann' : role === 'user' ? 'Caller' : role === 'tool' ? '[tool result]' : role;
    let t = typeof m.text === 'string' ? m.text.trim() : '';
    if (role === 'tool' && t.length > 220) t = t.slice(0, 220) + '…';
    let toolNote = '';
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const names = m.tool_calls.map((tc) => (tc.function && tc.function.name) || tc.name || '?').join(', ');
      toolNote = ` «Ann used: ${names}»`;
    }
    const line = (t || toolNote) ? `${who}: ${t}${toolNote}` : '';
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

async function gradeConv(conv, KEY) {
  const md = await tx(KEY, `/ai/conversations/${conv.id}/messages?page[size]=100`);
  const msgs = (md && md.data) || [];
  if (msgs.length < 3) return { skip: 'too short' };
  const transcript = transcriptOf(msgs);
  if (transcript.length < 60) return { skip: 'no usable transcript' };
  // Haiku, single pass (no tool loop), short timeout — grading is a fast structured judgment,
  // and this keeps several grades inside the 26s function window.
  const res = await runBrainTurn({ systemPrompt: RUBRIC, userContent: 'TRANSCRIPT:\n' + transcript.slice(0, 9000), maxTokens: 500, model: 'claude-haiku-4-5-20251001', maxIterations: 1, claudeTimeoutMs: 12000, ctx: { brain: 'call_grader' } });
  const g = tryParseJsonReply(res.reply || '') || {};
  if (typeof g.score !== 'number') return { skip: 'ungradeable (no score)', err: res.error || null, status: res.status, reply_snip: String(res.reply || '').slice(0, 200) };
  return { grade: { conv_id: conv.id, at: conv.created_at, score: Math.max(1, Math.min(10, Math.round(g.score))), outcome: g.outcome || '?', resolved: !!g.resolved, tools_ok: !!g.tools_ok, brand_voice_ok: !!g.brand_voice_ok, dead_air_or_error: !!g.dead_air_or_error, issues: Array.isArray(g.issues) ? g.issues.slice(0, 3) : [], one_line: String(g.one_line || '').slice(0, 240) } };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });
  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return j(200, { ok: false, error: 'TELNYX_API_KEY not in vault' });

  // ---- REPORT: the readiness scorecard ----
  if (q.report === '1') {
    const days = Math.max(1, Math.min(60, Number(q.days || 14)));
    const since = Date.now() - days * 864e5;
    let rows = []; try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'ann_call_grade' }, { id: 'desc' }, 500); } catch (_) {}
    const grades = rows.filter((r) => Number(r.created_at || 0) >= since).map(meta);
    const n = grades.length;
    const avg = n ? grades.reduce((s, g) => s + (Number(g.score) || 0), 0) / n : 0;
    const resolved = grades.filter((g) => g.resolved).length;
    const clean = grades.filter((g) => g.tools_ok && !g.dead_air_or_error).length;
    const outcomes = {}; grades.forEach((g) => { outcomes[g.outcome || '?'] = (outcomes[g.outcome || '?'] || 0) + 1; });
    const issues = {}; grades.forEach((g) => (g.issues || []).forEach((i) => { issues[i] = (issues[i] || 0) + 1; }));
    const topIssues = Object.entries(issues).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ issue: k, count: v }));
    return j(200, { ok: true, window_days: days, calls_graded: n, avg_score: Math.round(avg * 10) / 10, resolved_pct: n ? Math.round(resolved / n * 100) : 0, clean_run_pct: n ? Math.round(clean / n * 100) : 0, outcomes, top_issues: topIssues, recent: grades.slice(0, 12).map((g) => ({ score: g.score, outcome: g.outcome, one_line: g.one_line })) });
  }

  // ---- GRADE: pull recent conversations, grade the new ones ----
  const days = Math.max(1, Math.min(30, Number(q.days || 3)));
  const since = Date.now() - days * 864e5;
  const dry = q.dry === '1';
  let convs = [];
  try { const d = await tx(KEY, '/ai/conversations?page[size]=100'); convs = ((d && d.data) || []).filter((c) => Date.parse(c.last_message_at || c.created_at || 0) >= since); } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }

  const graded = [], skipped = [];
  const CAP = dry ? 2 : 5;   // per-run cap so several Haiku grades stay inside the 26s window; cron catches up
  let done = 0;
  for (const c of convs) {
    if (done >= CAP) break;
    if (!dry) { try { const prior = await crud.searchOne(crud.TABLES.event_log, { action: 'ann_call_graded_' + c.id }, { id: 'desc' }); if (prior) { skipped.push({ id: c.id, why: 'already graded' }); continue; } } catch (_) {} }
    const r = await gradeConv(c, KEY); done++;
    if (r.skip || !r.grade) { skipped.push({ id: c.id, why: r.skip || 'ungradeable', err: r.err, status: r.status, reply_snip: r.reply_snip }); continue; }
    const g = r.grade;
    if (!dry) {
      try { await crud.logEvent('ann_call_grade', { ...g, at_ms: Date.now() }); } catch (_) {}
      try { await crud.logEvent('ann_call_graded_' + g.conv_id, { score: g.score, at_ms: Date.now() }); } catch (_) {}
    }
    graded.push(g);
  }

  if (scheduled && graded.length) {
    const avg = graded.reduce((s, g) => s + g.score, 0) / graded.length;
    const lows = graded.filter((g) => g.score <= 6);
    let body = `📞 Ann call review — graded ${graded.length} new call(s), avg ${Math.round(avg * 10) / 10}/10.`;
    body += lows.length ? `\n⚠️ ${lows.length} rough:\n` + lows.slice(0, 3).map((g) => `• ${g.score}/10 — ${g.one_line}`).join('\n') : ` All clean. 🐜`;
    try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: body, force_send: true, context_tag: 'ann_call_review' }), signal: AbortSignal.timeout(9000) }); } catch (_) {}
  }

  return j(200, { ok: true, mode: dry ? 'dry' : (scheduled ? 'scheduled' : 'manual'), conversations_in_window: convs.length, graded: graded.length, skipped: skipped.length, grades: graded.map((g) => ({ score: g.score, outcome: g.outcome, resolved: g.resolved, tools_ok: g.tools_ok, dead_air: g.dead_air_or_error, one_line: g.one_line, issues: g.issues })), skipped_sample: skipped.slice(0, 6) });
};
