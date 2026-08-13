// telnyx-call-cost — "what does an Ann call actually cost us?" (Teddy 2026-08-13).
// Pulls the recent Telnyx AI conversations, measures each call's DURATION (the thing
// Telnyx bills on) from the conversation span, and prices it with a transparent rate
// table so we see per-call dollars + a monthly projection — not a guess.
//
// Rates (published Aug 2026, all overridable via query so we can true them up to a
// real Telnyx invoice later):
//   orch  = $0.05/min   Telnyx Voice AI orchestration (STT + TTS + turn-taking, bundled)
//   tel   = $0.0035/min inbound telephony (the phone minute itself)
//   llm   = $0.03/min   gpt-5.4 tokens, blended est. WITH OpenAI prompt-caching on our
//                       big static system prompt ($2.50/M in, $0.25/M cached, $15/M out).
//                       ~$0.02-0.05/min depending on how chatty the call is.
//   => all-in ~ $0.084/min.  A 3-min call ~ $0.25.
//
//   GET ?secret=&days=7[&calls=1][&orch=&tel=&llm=][&per_day=<calls/day for projection>]
'use strict';

const { getSecret } = require('./_lib/secrets');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TELNYX = 'https://api.telnyx.com/v2';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }
const money = (n) => '$' + (Math.round(n * 1000) / 1000).toFixed(3);

async function tx(key, path, ms = 12000) {
  const r = await fetch(`${TELNYX}${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  return r.json().catch(() => ({}));
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return j(403, { ok: false, error: 'forbidden' });
  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return j(200, { ok: false, error: 'TELNYX_API_KEY not in vault' });

  // Rate table (per minute), query-overridable so we can match the real invoice.
  const ORCH = Number(q.orch || 0.05);
  const TEL = Number(q.tel || 0.0035);
  const LLM = Number(q.llm || 0.03);
  const PER_MIN = ORCH + TEL + LLM;

  const days = Math.max(1, Math.min(90, Number(q.days || 7)));
  const cutoff = Date.now() - days * 864e5;

  let convs = [];
  try {
    const d = await tx(KEY, '/ai/conversations?page[size]=100', 12000);
    convs = (d.data || []).filter((c) => Date.parse(c.last_message_at || c.created_at || 0) >= cutoff);
  } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }

  const rows = [];
  for (const c of convs) {
    const start = Date.parse(c.created_at || 0);
    const end = Date.parse(c.last_message_at || c.created_at || 0);
    let sec = Math.max(0, (end - start) / 1000);
    // Telnyx bills whole call minutes; conversation span is a close proxy. Guard the
    // zero/near-zero spans (missed/instant hangups) so they don't skew the average — a
    // real answered call is at least a handful of seconds of talk.
    const min = sec / 60;
    const cost = min * PER_MIN;
    rows.push({ id: c.id, at: c.created_at, duration_sec: Math.round(sec), duration_min: Math.round(min * 100) / 100, est_cost: Math.round(cost * 1000) / 1000 });
  }

  // Only price calls that actually connected (>= ~5s of conversation) for the average.
  const real = rows.filter((r) => r.duration_sec >= 5);
  const totalMin = real.reduce((s, r) => s + r.duration_min, 0);
  const totalCost = real.reduce((s, r) => s + r.est_cost, 0);
  const n = real.length;
  const avgMin = n ? totalMin / n : 0;
  const avgCost = n ? totalCost / n : 0;

  const perDay = Number(q.per_day || 0);
  const projection = perDay > 0 ? {
    assumed_calls_per_day: perDay,
    est_cost_per_day: money(avgCost * perDay),
    est_cost_per_month: money(avgCost * perDay * 30),
  } : null;

  const out = {
    ok: true,
    window_days: days,
    rate_per_minute: {
      orchestration: money(ORCH), telephony: money(TEL), llm_gpt54: money(LLM), all_in: money(PER_MIN),
      note: 'orchestration+telephony are published Telnyx rates; llm is a caching-aware gpt-5.4 estimate — override ?llm= to true it up to a real invoice.',
    },
    calls_seen: rows.length,
    calls_connected: n,
    avg_call_minutes: Math.round(avgMin * 100) / 100,
    avg_cost_per_call: money(avgCost),
    total_cost_window: money(totalCost),
    cost_per_100_calls: money(avgCost * 100),
    projection,
    ballpark: {
      quick_2min: money(2 * PER_MIN),
      typical_3min: money(3 * PER_MIN),
      long_5min: money(5 * PER_MIN),
    },
  };
  if (q.calls === '1') out.recent_calls = rows.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0)).slice(0, 25);
  return j(200, out);
};
