// usage-meter — per-client usage tracking + the per-client circuit breaker. Every metered event
// (a voice minute, an SMS) is recorded against a company_id with OUR cost; a guardrail check runs
// BEFORE a send so a runaway (our glitch OR abuse) is physically capped per shop — the flood can't
// happen, so flat pricing is safe and a malfunction costs pennies. Rollups give the operator the
// cost/margin per client. Service-key + server-side only (ANT Platforms).
'use strict';
const { getSecret, criticalSecret } = require('./secrets');

// OUR marginal cost per unit, in cents — voice measured against a MATCHED 3-day window of
// Telnyx Detail Records 2026-09-08, pulling EVERY billing record type (not just one):
//   ai-voice-assistant  190 min / $9.50  = $0.0500/min  (voice engine: orchestration+STT+TTS)
//   inference           777 recs / $3.37 = $0.0177/min  (LLM tokens — BILLS SEPARATELY)
//   call-control                  $0.00                 (telephony — not per-minute for us)
//   sip-trunking                  $0.00
//   => all-in $0.0677/min. 30-day ai-voice cross-check: 901 calls / 1,951 min / $97.55.
// LLM is an ADD-ON, confirmed by Telnyx's own pricing calculator. We run openai/gpt-5.4
// (managed frontier model) at ~$0.0177/min; Telnyx-hosted Kimi is ~$0.004/min, so moving
// Ann's brain to Kimi would cut all-in to ~$0.054/min — a brain-quality tradeoff, not free.
// SMS: Telnyx bills per SEGMENT, not per message -- $0.0122 out (rate + carrier fee), $0.0089 in,
// both measured off billed detail records. A message is 1 segment only if it is pure GSM-7 and
// <=160 chars; ONE emoji / em dash / curly quote flips it to UCS-2 and the limit drops to 70, so
// our texts averaged 3.17 segments (~3.7c each) until the 2026-09-09 GSM-7 cleanup of the default
// templates took them to ~1.9 (~2.3c). sms_out/sms_in below are per MESSAGE (what record() counts)
// and are FALLBACK ESTIMATES -- pass costCents from the carrier record whenever you have it.
// Cost basis only — never shown to a shop.
const COST = { voice_min: 6.8, sms_seg: 1.22, sms_out: 2.3, sms_in: 0.89 };
// Plan defaults when a shop has no client_plan row yet (generous fair-use + safety caps). These
// MIRROR platform/plans.js ANN / ANN_PRO — that file is what BILLS; this is what the meter, the
// weekly digest, and the owner dashboard card show. Keep the two in step or a shop sees an
// allowance it isn't actually on.
//   Starter $50/wk  =  400 min + 250 texts,  overage $0.40/min, $0.05/text
//   Pro    $125/wk  = 1000 min + 800 texts,  overage $0.25/min, $0.05/text
// Both are 12.5c per included minute — Pro buys headroom, not a better rate. Included texts went
// 100 -> 250 on 2026-09-08: at ~5 texts/job (confirm, day-before, on-my-way, complete, review ask)
// 100 was only ~20 jobs/wk, so nearly every shop hit text overage in week one on messages OUR
// automation sent. 250 ~= 50 jobs/wk, so overage only reaches a genuinely busy shop.
const DEFAULT_PLAN = {
  tier: 'ann_weekly', base_price_cents: 5000, billing_period: 'week', included_voice_min: 400, included_sms: 250,
  voice_overage_cents: 40, sms_overage_cents: 5,
  cap_sms_per_hour: 200, cap_sms_per_day: 2000, cap_voice_min_per_day: 600, hard_stop: false,
};
const DEFAULT_PLAN_PRO = {
  tier: 'ann_pro', base_price_cents: 12500, billing_period: 'week', included_voice_min: 1000, included_sms: 800,
  voice_overage_cents: 25, sms_overage_cents: 5,
  cap_sms_per_hour: 400, cap_sms_per_day: 4000, cap_voice_min_per_day: 1200, hard_stop: false,
};
// Defaults for a tier key. Unknown/absent -> Starter, so an untagged tenant is unchanged.
function planDefaultsForTier(key) { return key === 'ann_pro' ? DEFAULT_PLAN_PRO : DEFAULT_PLAN; }

async function db() {
  // criticalSecret: an empty read drops usage on the floor — under-billing, not an error. (2026-09-10)
  const base = ((await criticalSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await criticalSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}

// An explicit client_plan row always wins. With no row we fall back to the defaults for the tier
// the company is actually ON (company.settings.phone.ann_tier) — otherwise a Pro shop with no row
// would be shown a 400-minute allowance it already paid past. Tier read costs one extra fetch and
// only happens on the no-row path.
async function getPlan(companyId) {
  const { base, H } = await db();
  try {
    const r = await fetch(`${base}/rest/v1/client_plan?company_id=eq.${companyId}&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    const row = r.ok ? ((await r.json().catch(() => []))[0]) : null;
    if (row) return row;
  } catch (_) { /* fall through to tier default */ }
  let tierKey = '';
  try {
    const r2 = await fetch(`${base}/rest/v1/company?id=eq.${companyId}&select=settings&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    const c = r2.ok ? ((await r2.json().catch(() => []))[0]) : null;
    tierKey = (c && c.settings && c.settings.phone && c.settings.phone.ann_tier) || '';
  } catch (_) {}
  return { company_id: companyId, ...planDefaultsForTier(tierKey), _default: true };
}

// Count qty of a kind for a company since `sinceISO`.
async function countSince(companyId, kind, sinceISO) {
  const { base, H } = await db();
  try {
    const r = await fetch(`${base}/rest/v1/usage_event?company_id=eq.${companyId}&kind=eq.${kind}&at=gte.${encodeURIComponent(sinceISO)}&select=qty`, { headers: H, signal: AbortSignal.timeout(8000) });
    const rows = r.ok ? (await r.json().catch(() => [])) : [];
    return rows.reduce((s, x) => s + Number(x.qty || 0), 0);
  } catch (_) { return 0; }
}

// THE per-client circuit breaker. Call before sending. Returns {allow, reason, hour, day, cap, hard}.
// hard_stop=false -> always allows but flags (alert-only mode). Fails OPEN on error (never blocks
// legit work because the meter hiccuped) — the send paths' own guards are the backstop.
async function guardrail(companyId, kind, addQty) {
  const q = Number(addQty || 1);
  try {
    const plan = await getPlan(companyId);
    const now = Date.now();
    const hourAgo = new Date(now - 3600e3).toISOString();
    const dayAgo = new Date(now - 24 * 3600e3).toISOString();
    if (kind === 'sms_out') {
      const [h, d] = await Promise.all([countSince(companyId, 'sms_out', hourAgo), countSince(companyId, 'sms_out', dayAgo)]);
      const overHour = (h + q) > plan.cap_sms_per_hour, overDay = (d + q) > plan.cap_sms_per_day;
      if ((overHour || overDay)) return { allow: !plan.hard_stop, hard: plan.hard_stop, reason: overHour ? 'sms_hourly_cap' : 'sms_daily_cap', hour: h, day: d, cap: overHour ? plan.cap_sms_per_hour : plan.cap_sms_per_day };
      return { allow: true, hour: h, day: d };
    }
    if (kind === 'voice_min') {
      const d = await countSince(companyId, 'voice_min', dayAgo);
      if ((d + q) > plan.cap_voice_min_per_day) return { allow: !plan.hard_stop, hard: plan.hard_stop, reason: 'voice_daily_cap', day: d, cap: plan.cap_voice_min_per_day };
      return { allow: true, day: d };
    }
    return { allow: true }; // inbound + other kinds are always allowed
  } catch (_) { return { allow: true, fail_open: true }; }
}

// Record a metered event (after it happened / succeeded). cost auto-computed unless given.
async function record(companyId, kind, qty, opts) {
  const o = opts || {};
  const q = Number(qty || 0);
  const cost = o.costCents != null ? Number(o.costCents) : Math.round(q * (COST[kind] || 0) * 100) / 100;
  const { base, H } = await db();
  try {
    const r = await fetch(`${base}/rest/v1/usage_event`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: companyId, kind, qty: q, cost_cents: cost, source: o.source || 'app', meta: o.meta || {} }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch (_) { return false; }
}

// Rollup for one company over [from,to). Returns { voice_min, sms_out, sms_in, cost_cents }.
async function rollup(companyId, fromISO, toISO) {
  const { base, H } = await db();
  try {
    const r = await fetch(`${base}/rest/v1/rpc/usage_rollup`, {
      method: 'POST', headers: H, body: JSON.stringify({ p_company: companyId, p_from: fromISO, p_to: toISO }), signal: AbortSignal.timeout(9000),
    });
    const rows = r.ok ? (await r.json().catch(() => [])) : [];
    return rows[0] || { voice_min: 0, sms_out: 0, sms_in: 0, cost_cents: 0 };
  } catch (_) { return { voice_min: 0, sms_out: 0, sms_in: 0, cost_cents: 0 }; }
}

// Owner-FACING month-to-date digest — usage vs the shop's plan allowance ONLY.
// Deliberately carries NO cost / margin / provider (that's the operator-only view). This
// is what the owner sees ("340 of 400 minutes used"), keeping the underlying provider +
// per-unit cost ours. from = first of THIS month (UTC).
async function ownerDigest(companyId) {
  var d = new Date();
  var from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  var res = await Promise.all([rollup(companyId, from, new Date().toISOString()), getPlan(companyId)]);
  var roll = res[0], plan = res[1];
  var vmin = Math.round(Number(roll.voice_min) || 0);
  var sms = Math.round(Number(roll.sms_out) || 0);
  return {
    period: from.slice(0, 7),
    voice_min: vmin, sms_out: sms,
    included_voice_min: plan.included_voice_min, included_sms: plan.included_sms,
    voice_pct: plan.included_voice_min ? Math.round(vmin / plan.included_voice_min * 100) : 0,
    sms_pct: plan.included_sms ? Math.round(sms / plan.included_sms * 100) : 0,
    over_voice: Math.max(0, vmin - plan.included_voice_min),
    over_sms: Math.max(0, sms - plan.included_sms),
    tier: plan.tier,
    has_usage: vmin > 0 || sms > 0,
  };
}

// ── WEEKLY (Mon–Sun, Central) usage read straight from Telnyx, BY NUMBER — accurate metering
// for the $50/week/400-minute model. Texts = outbound records from the shop's number (cli);
// minutes = the shop's Ann conversations (matched by assistant_id). Each tenant = one number +
// one assistant, so this is exact per shop.
function ctOffsetMin(ms) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName').value;
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(s); if (!m) return -300;
    const h = parseInt(m[1], 10), mm = m[2] ? parseInt(m[2], 10) : 0;
    return h * 60 + (h < 0 ? -mm : mm);
  } catch (_) { return -300; }
}
function weekBoundsCT(now) {
  now = now || Date.now();
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(new Date(now));
  const idx = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(dayName);
  const daysSinceMon = (idx + 6) % 7;
  const dstr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const [y, mo, d] = dstr.split('-').map(Number);
  const mon = new Date(Date.UTC(y, mo - 1, d) - daysSinceMon * 86400000);
  const my = mon.getUTCFullYear(), mm = mon.getUTCMonth(), md = mon.getUTCDate();
  const off = ctOffsetMin(Date.UTC(my, mm, md, 12, 0, 0)); // noon avoids the DST edge
  const startMs = Date.UTC(my, mm, md, 0, 0, 0) - off * 60000;
  const endMs = startMs + 7 * 86400000;
  const fmt = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(ms));
  return { startMs, endMs, startISO: new Date(startMs).toISOString(), label: fmt(startMs) + '–' + fmt(endMs - 1) };
}
async function txGet(path) {
  const key = process.env.TELNYX_API_KEY || (await getSecret('TELNYX_API_KEY'));
  const r = await fetch('https://api.telnyx.com/v2' + path, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
  return r.ok ? r.json().catch(() => ({})) : {};
}
async function weeklyTelnyx(number, assistantId, now) {
  const wb = weekBoundsCT(now);
  let texts = 0, minutes = 0;
  if (number) {
    try {
      for (let p = 1; p <= 6; p++) {
        const d = await txGet(`/detail_records?filter[record_type]=messaging&filter[direction]=outbound&filter[cli]=${encodeURIComponent(number)}&filter[created_at][gte]=${encodeURIComponent(wb.startISO)}&page[size]=250&page[number]=${p}`);
        const rows = Array.isArray(d.data) ? d.data : [];
        texts += rows.length;
        if (rows.length < 250) break;
        await new Promise((r) => setTimeout(r, 220));
      }
    } catch (_) {}
  }
  if (assistantId) {
    try {
      for (let p = 1; p <= 30; p++) {
        const d = await txGet(`/ai/conversations?page[size]=100&page[number]=${p}`);
        const rows = Array.isArray(d.data) ? d.data : [];
        if (!rows.length) break;
        let allOld = true;
        for (const c of rows) {
          const aid = c.assistant_id || (c.metadata && c.metadata.assistant_id);
          const start = Date.parse(c.created_at || 0), end = Date.parse(c.last_message_at || c.created_at || 0);
          if (start >= wb.startMs) allOld = false;
          if (aid === assistantId && start >= wb.startMs && start < wb.endMs) {
            const sec = Math.max(0, (end - start) / 1000);
            if (sec >= 5) minutes += sec / 60;
          }
        }
        if (allOld) break;
        await new Promise((r) => setTimeout(r, 220));
      }
    } catch (_) {}
  }
  return { week_label: wb.label, week_start: wb.startISO, minutes: Math.round(minutes), texts };
}
// Shape the weekly numbers against an allowance for the owner digest / dashboard.
function weeklyStatus(w, allowanceMin) {
  const allow = allowanceMin || DEFAULT_PLAN.included_voice_min;
  const pct = allow ? Math.round((w.minutes / allow) * 100) : 0;
  return { minutes: w.minutes, texts: w.texts, allowance_min: allow, pct, over: w.minutes >= allow, near: pct >= 80, week_label: w.week_label };
}

module.exports = { COST, DEFAULT_PLAN, DEFAULT_PLAN_PRO, planDefaultsForTier, getPlan, guardrail, record, rollup, ownerDigest, weekBoundsCT, weeklyTelnyx, weeklyStatus };
