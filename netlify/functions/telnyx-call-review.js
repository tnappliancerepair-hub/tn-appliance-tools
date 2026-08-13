// telnyx-call-review — Ann's self-teaching flywheel (Teddy 2026-08-13: "make it the
// greatest phone system ever — she grades her own calls and gets better every night").
//
// THE LOOP: reads Ann's real Telnyx call transcripts from the last N hours, grades each
// one with a model (did she CLOSE the cash call? serve the warranty call cleanly? where
// did she stumble? what did she not know?), rolls it into a scorecard (calls, booked/held,
// intake sent, transferred, lost, close-rate), and texts Teddy the top 1-3 fixes to make
// her sharper. This is exactly the manual loop we ran the day she didn't know the $50 vs
// $100 offer — now automatic, every night. Recurring gaps get logged so they rise to the
// top and get fixed first (the #1 goal: the smartest brain in the trade, on the phone).
//
// HTTP-callable core (pull anytime): ?secret=VAPI_ADMIN_SECRET[&hours=24][&limit=15][&text=0]
// The nightly cron wrapper (telnyx-call-review-cron) fires this with text=1. A scheduled
// function 403s on direct HTTP, so the logic lives here in the on-demand core.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const TELNYX = 'https://api.telnyx.com/v2';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GRADER = 'claude-sonnet-4-5-20250929';
const OWNER = '+16154855795';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SITE = 'https://tnapplianceexchange.net/.netlify/functions';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function tx(KEY, path, ms) {
  const r = await fetch(`${TELNYX}${path}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(ms || 12000) });
  return r.json().catch(() => ({}));
}

// Flatten a Telnyx message content field (string OR array of blocks) to plain text.
function msgText(m) {
  let t = m.content != null ? m.content : (m.text != null ? m.text : '');
  if (Array.isArray(t)) t = t.map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).join(' ');
  return String(t || '').trim();
}

const PROMPT = `You are the QA coach for "Ann," the AI phone agent for TN Appliance Exchange, a family-owned appliance repair company. Grade each real call transcript below.

Ann's goals by track:
- CASH (self-pay): CLOSE the job. A win = booked, a scheduling hold placed, or the $50 Quick Check / video intake link sent. She should lead with empathy, surface the cost of waiting, steer to the $50 Quick Check (link -> short video + model photo -> pay $50 -> remote diagnosis + options; the fee credits toward the repair), close on a CHOICE not a yes/no, and never let them hang up empty-handed.
- WARRANTY: efficient, accurate service (job's already ours). Confirm the claim/work order, answer status, gather availability, warm-transfer to a human with a brief, or connect to the tech. Do NOT sell.

For EVERY call judge honestly: did she achieve the goal? Where did she stumble, over-promise, sound robotic, miss a close, or NOT KNOW something (a real knowledge/skill gap)?

Return STRICT JSON only, no prose, no code fences:
{"calls":[{"id":"<id>","track":"cash|warranty|unknown","outcome":"booked|hold|intake_sent|transferred|info_only|lost|spam|test","closed_well":true|false,"summary":"one plain line","stumble":"where she fumbled, or empty","gap":"a specific fixable knowledge/skill gap, or empty"}],"scorecard":{"total":0,"cash":0,"warranty":0,"won":0,"intake_sent":0,"transferred":0,"lost":0,"close_rate_pct":0},"top_fixes":["highest-value change to make her close/serve better","..."]}
"won" = booked + hold + intake_sent. close_rate_pct = won / (cash calls that weren't spam/test), rounded. top_fixes: 1-3 concrete, specific coaching changes (not generic). CALLS:
`;

async function grade(AK, calls) {
  const body = { model: GRADER, max_tokens: 1600, messages: [{ role: 'user', content: PROMPT + JSON.stringify(calls) }] };
  const r = await fetch(ANTHROPIC_URL, { method: 'POST', headers: { 'x-api-key': AK, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(21000) });
  const d = await r.json();
  let t = ((d.content || []).map((b) => b.text || '').join('') || '').trim();
  t = t.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(t);
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const KEY = await getSecret('TELNYX_API_KEY');
  const AK = (await getSecret('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY;
  if (!KEY) return json(200, { ok: false, error: 'no TELNYX_API_KEY in vault' });

  const hours = Math.min(168, parseInt(q.hours || '24', 10) || 24);
  const limit = Math.min(40, parseInt(q.limit || '15', 10) || 15);
  const doText = q.text !== '0';
  const cutoff = Date.now() - hours * 3600000;

  // 1) Recent conversations, newest first, within the lookback window.
  let convos = [];
  try {
    const d = await tx(KEY, '/ai/conversations?page[size]=100', 12000);
    convos = (d.data || [])
      .filter((c) => { const t = Date.parse(c.last_message_at || c.created_at || 0); return t >= cutoff; })
      .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
      .slice(0, limit);
  } catch (_) {}

  // 2) Pull each transcript in parallel (bounded by limit); detect the track from the
  //    injected persona in the system prompt.
  const calls = (await Promise.all(convos.map(async (c) => {
    let msgs = [];
    try { const m = await tx(KEY, `/ai/conversations/${c.id}/messages?page[size]=100`, 9000); msgs = m.data || []; } catch (_) {}
    const ordered = msgs.slice().sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0));
    const lines = [];
    for (const mm of ordered) {
      const t = msgText(mm);
      if (mm.role === 'user' && t) lines.push(`CALLER: ${t}`);
      else if (mm.role === 'assistant' && t) lines.push(`ANN: ${t}`);
    }
    if (!lines.length) return null;
    const sp = c.system_prompt || '';
    const track = /CALL TRACK\D+WARRANTY/i.test(sp) ? 'warranty' : (/CALL TRACK\D+CASH/i.test(sp) ? 'cash' : 'unknown');
    return { id: c.id, at: c.created_at, track, transcript: lines.join('\n').slice(0, 3500) };
  }))).filter(Boolean);

  if (!calls.length) {
    return json(200, { ok: true, reviewed: 0, note: 'no calls with transcripts in window' });
  }
  if (!AK) return json(200, { ok: false, error: 'no ANTHROPIC_API_KEY', reviewed: 0, calls: calls.length });

  // 3) Grade them all in one pass.
  let result = null, gradeErr = null;
  try { result = await grade(AK, calls); } catch (e) { gradeErr = String((e && e.message) || e); }
  if (!result) return json(200, { ok: false, error: 'grade_failed', detail: gradeErr, reviewed: calls.length });

  const sc = result.scorecard || {};
  const fixes = (result.top_fixes || []).filter(Boolean).slice(0, 3);

  // 4) Persist: the scorecard trend + each specific gap (so recurring gaps rise to the top).
  try { await crud.logEvent('telnyx_call_review', { hours, reviewed: calls.length, scorecard: sc, top_fixes: fixes, at_ms: Date.now() }); } catch (_) {}
  for (const c of (result.calls || [])) {
    if (c && c.gap && String(c.gap).trim()) { try { await crud.logEvent('telnyx_ann_gap', { conversation_id: c.id, track: c.track, gap: String(c.gap).slice(0, 300), outcome: c.outcome, at_ms: Date.now() }); } catch (_) {} }
  }

  // 5) Text Teddy the digest — the number + the top fixes to make her sharper.
  let texted = false;
  if (doText) {
    const L = [`🐜 Ann nightly review (${hours}h): ${sc.total ?? calls.length} calls`];
    L.push(`won ${sc.won ?? 0} · intake ${sc.intake_sent ?? 0} · to office ${sc.transferred ?? 0} · lost ${sc.lost ?? 0}${sc.cash != null ? ` · close ${sc.close_rate_pct ?? 0}% of ${sc.cash} cash` : ''}`);
    if (fixes.length) { L.push('Make her better:'); fixes.forEach((f, i) => L.push(`${i + 1}) ${f}`)); }
    L.push(`Pull full: ${SITE}/telnyx-call-review?secret=…`);
    try { await sendSms(OWNER, L.join('\n'), 'owner', 'telnyx_call_review'); texted = true; } catch (_) {}
  }

  return json(200, { ok: true, reviewed: calls.length, texted, scorecard: sc, top_fixes: fixes, calls: result.calls || [] });
};
