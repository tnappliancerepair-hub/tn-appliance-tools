// SPEND TRACKING + DAILY CAP
//
// Three jobs:
//   1. calcCallCost(model, tokensIn, tokensOut) — Anthropic pricing
//      lookup. Returns USD as a number.
//   2. recordSpend(usd) — increment in-memory daily counter. Resets at
//      midnight CT.
//   3. checkSpendGate({ critical }) — returns { allow: bool, reason }
//      based on current spend vs ANT_DAILY_SPEND_CAP_USD. Critical
//      paths bypass the gate (Tech Assist mid-job, customer reply); a
//      separate ANT_DAILY_HARD_CAP_USD will eventually stop even
//      critical calls if we ever ship a runaway loop.
//
// In-memory by design — fail-open on Netlify cold-start (the gate
// will reset to 0 spend, allowing calls). We accept slightly over the
// cap during cold-start storms in exchange for not paying a Xano
// roundtrip on every brain call. The claude_call_log table has the
// ground truth for backfill / dispute.

// Anthropic pricing per million tokens. Update when pricing changes.
// Lookup by longest-prefix-match on model id.
const PRICING_PER_MTOK = [
  // Opus
  ['claude-opus-4-7', { in: 15.00, out: 75.00 }],
  ['claude-opus-4-6', { in: 15.00, out: 75.00 }],
  ['claude-opus-4-5', { in: 15.00, out: 75.00 }],
  ['claude-opus',     { in: 15.00, out: 75.00 }],
  // Sonnet
  ['claude-sonnet-4-6', { in: 3.00, out: 15.00 }],
  ['claude-sonnet-4-5', { in: 3.00, out: 15.00 }],
  ['claude-sonnet-4',   { in: 3.00, out: 15.00 }],
  ['claude-sonnet',     { in: 3.00, out: 15.00 }],
  // Haiku
  ['claude-haiku-4-5', { in: 0.80, out: 4.00 }],
  ['claude-haiku-4',   { in: 0.80, out: 4.00 }],
  ['claude-haiku',     { in: 0.80, out: 4.00 }],
];

function pricingFor(model) {
  const m = String(model || '').toLowerCase();
  for (const [prefix, p] of PRICING_PER_MTOK) {
    if (m.startsWith(prefix)) return p;
  }
  return null;
}

function calcCallCost(model, tokensIn, tokensOut) {
  const p = pricingFor(model);
  if (!p) return 0; // unknown model — don't fake
  return (Number(tokensIn || 0) / 1_000_000) * p.in
       + (Number(tokensOut || 0) / 1_000_000) * p.out;
}

// In-memory daily counter. ctDateKey resets at midnight CT.
let _state = { dateKey: '', usd: 0 };

function ctDateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function _resetIfNewDay() {
  const k = ctDateKey();
  if (k !== _state.dateKey) {
    _state = { dateKey: k, usd: 0 };
  }
}

function recordSpend(usd) {
  _resetIfNewDay();
  const n = Number(usd || 0);
  if (n > 0) _state.usd += n;
  return _state.usd;
}

function todaysSpend() {
  _resetIfNewDay();
  return _state.usd;
}

// Returns { allow, reason, today_usd, soft_cap_usd, hard_cap_usd, critical }
// Soft cap blocks non-critical brain calls; hard cap blocks ALL calls
// (only a runaway-loop guard — set higher than soft).
function checkSpendGate({ critical } = {}) {
  _resetIfNewDay();
  const softCap = Number(process.env.ANT_DAILY_SPEND_CAP_USD || 50);
  const hardCap = Number(process.env.ANT_DAILY_HARD_CAP_USD || softCap * 4);
  const today = _state.usd;
  if (today >= hardCap) {
    return { allow: false, reason: `hard cap $${hardCap} reached (today $${today.toFixed(2)})`, today_usd: today, soft_cap_usd: softCap, hard_cap_usd: hardCap, critical: !!critical };
  }
  if (today >= softCap && !critical) {
    return { allow: false, reason: `soft cap $${softCap} reached (today $${today.toFixed(2)}); non-critical call denied`, today_usd: today, soft_cap_usd: softCap, hard_cap_usd: hardCap, critical: !!critical };
  }
  return { allow: true, reason: '', today_usd: today, soft_cap_usd: softCap, hard_cap_usd: hardCap, critical: !!critical };
}

// Per-phone live abuse detection. Independent of materialized
// customer_intel (which is 24h stale). Tracks inbound count per phone
// in a rolling 1-hour window. If a phone fires >ABUSE_INBOUND_PER_HOUR
// calls, the gate refuses + alerts Teddy.
//
// In-memory only — survives within a single Netlify warm instance.
// Cold-start resets the counter, allowing a burst. We accept that
// imprecision in exchange for not paying a Xano lookup on every
// customer-facing call.
const _phoneState = new Map(); // phone → { count, windowStart }
const ABUSE_INBOUND_PER_HOUR = Number(process.env.ANT_ABUSE_INBOUND_PER_HOUR || 12);
const ABUSE_WINDOW_MS = 60 * 60 * 1000;

function checkPhoneAbuseGate(phone) {
  if (!phone) return { allow: true };
  const now = Date.now();
  const key = String(phone).replace(/\D/g, '').slice(-10);
  if (!key) return { allow: true };
  let s = _phoneState.get(key);
  if (!s || (now - s.windowStart) > ABUSE_WINDOW_MS) {
    s = { count: 0, windowStart: now };
    _phoneState.set(key, s);
  }
  s.count += 1;
  if (s.count > ABUSE_INBOUND_PER_HOUR) {
    return {
      allow: false,
      reason: `phone ${key} hit ${s.count} inbound calls within ${Math.round((now - s.windowStart) / 60000)} min (limit ${ABUSE_INBOUND_PER_HOUR}/hr)`,
      phone_count: s.count,
    };
  }
  return { allow: true, phone_count: s.count };
}

module.exports = {
  calcCallCost,
  recordSpend,
  todaysSpend,
  checkSpendGate,
  checkPhoneAbuseGate,
};
