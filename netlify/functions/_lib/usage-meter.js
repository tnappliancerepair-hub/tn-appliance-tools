// usage-meter — per-client usage tracking + the per-client circuit breaker. Every metered event
// (a voice minute, an SMS) is recorded against a company_id with OUR cost; a guardrail check runs
// BEFORE a send so a runaway (our glitch OR abuse) is physically capped per shop — the flood can't
// happen, so flat pricing is safe and a malfunction costs pennies. Rollups give the operator the
// cost/margin per client. Service-key + server-side only (ANT Platforms).
'use strict';
const { getSecret } = require('./secrets');

// OUR marginal cost per unit, in cents (conservative — slightly above real cost for safety).
// Editable here; could move to the vault later. Used only to compute margin, never shown to shops.
const COST = { voice_min: 12, sms_out: 1, sms_in: 0.75 };
// Plan defaults when a shop has no client_plan row yet (generous fair-use + safety caps).
const DEFAULT_PLAN = {
  tier: 'starter', base_price_cents: 0, included_voice_min: 500, included_sms: 200,
  voice_overage_cents: 0, sms_overage_cents: 0,
  cap_sms_per_hour: 200, cap_sms_per_day: 2000, cap_voice_min_per_day: 600, hard_stop: true,
};

async function db() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}

async function getPlan(companyId) {
  const { base, H } = await db();
  try {
    const r = await fetch(`${base}/rest/v1/client_plan?company_id=eq.${companyId}&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    const row = r.ok ? ((await r.json().catch(() => []))[0]) : null;
    return row || { company_id: companyId, ...DEFAULT_PLAN, _default: true };
  } catch (_) { return { company_id: companyId, ...DEFAULT_PLAN, _default: true }; }
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
// is what the owner sees ("340 of 500 minutes used"), keeping the underlying provider +
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

module.exports = { COST, DEFAULT_PLAN, getPlan, guardrail, record, rollup, ownerDigest };
