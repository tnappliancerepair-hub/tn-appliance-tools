// sms-guard — the single safety chokepoint for outbound CUSTOMER texts.
//
// Teddy 2026-07-02 audit, weakness #1: the system texts customers a lot and the
// SMS breaker has tripped more than once. Two real dangers this closes:
//   (a) TCPA — texting someone who said STOP, or outside 8am–9pm, is $500–1,500
//       PER TEXT. At one shop with the owner watching it's fine; across leased
//       shops it's a class-action vector.
//   (b) Flood — over-emission bugs have nearly spammed real people; the breaker
//       is a backstop, not a guarantee.
//
// This makes those STRUCTURAL, not "we'll be careful":
//   1. OPT-OUT is absolute + permanent. Once a phone says STOP we never text it
//      again (until they text START). Enforced ALWAYS, zero-risk (internal
//      numbers never opt out, so owner/tech alerts are unaffected).
//   2. QUIET HOURS — no customer texts outside 8am–9pm CT (TN + LA are both
//      Central). Same-day en-route/ETA texts the customer is expecting can pass
//      with allowQuiet.
//   3. FREQUENCY CAP — per-customer 24h + 7d ceilings (anti-nag).
//   4. GLOBAL RATE — rolling-10-min ceiling across ALL customers (anti-flood,
//      the breaker centralized).
//
// SAFE ROLLOUT: opt-out enforces immediately (can only PREVENT texting a STOP'd
// number — never blocks a good send). Quiet-hours/frequency/global are
// SHADOW-logged by default (we record what WOULD be blocked) and only hard-block
// when SMS_GUARD_ENFORCE=1. Flip that on once you've eyeballed the shadow data.
'use strict';

const crud = require('./xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const ENFORCE = String(process.env.SMS_GUARD_ENFORCE || '') === '1'
  || String(process.env.SMS_GUARD_ENFORCE || '').toLowerCase() === 'true';
const QUIET_START = Number(process.env.SMS_QUIET_START_CT) || 8;    // 8am CT
const QUIET_END = Number(process.env.SMS_QUIET_END_CT) || 21;      // 9pm CT
const CAP_24H = Number(process.env.SMS_CAP_24H) > 0 ? Number(process.env.SMS_CAP_24H) : 4;
const CAP_7D = Number(process.env.SMS_CAP_7D) > 0 ? Number(process.env.SMS_CAP_7D) : 10;
const GLOBAL_10MIN = Number(process.env.SMS_GLOBAL_10MIN) > 0 ? Number(process.env.SMS_GLOBAL_10MIN) : 45;

// Carriers (Telnyx) already auto-block STOP'd numbers at the network level —
// this is defense-in-depth PLUS it lets Ant KNOW not to enqueue (no wasted
// sends, no "why no reply" confusion, and a clean audit trail).
const STOP_RE = /^\s*(stop|stopall|unsubscribe|unsub|cancel|end|quit|opt\s*out|optout|remove)\s*[.!]*\s*$/i;
const START_RE = /^\s*(start|unstop|resubscribe|resub|opt\s*in|optin)\s*[.!]*\s*$/i;

function toE164(p) {
  let s = String(p || '').trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d ? '+' + d : '';
}
function isStop(b) { return STOP_RE.test(String(b || '')); }
function isStart(b) { return START_RE.test(String(b || '')); }

function ctHour(d) {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(d || new Date()), 10);
}
function inQuietHours(d) { const h = ctHour(d); return h < QUIET_START || h >= QUIET_END; }

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(r) { return Number(metaOf(r).at_ms) || Date.parse(r && r.created_at) || 0; }

// Opted out if the newest opt-out marker is newer than the newest opt-in.
async function isOptedOut(phone) {
  const e = toE164(phone); if (!e) return false;
  try {
    const outs = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_opt_out' }, { id: 'desc' }, 500);
    const ins = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_opt_in' }, { id: 'desc' }, 500);
    const newest = (rows) => Math.max(0, ...(rows || []).filter((r) => toE164(metaOf(r).phone) === e).map(tsOf));
    return newest(outs) > newest(ins);
  } catch (_) { return false; } // fail-open: Telnyx carrier-level STOP is the hard backstop
}

async function recordOptOut(phone, source) { try { await crud.logEvent('sms_opt_out', { phone: toE164(phone), source: source || 'inbound', at_ms: Date.now() }); } catch (_) {} }
async function clearOptOut(phone, source) { try { await crud.logEvent('sms_opt_in', { phone: toE164(phone), source: source || 'inbound', at_ms: Date.now() }); } catch (_) {} }

async function sentSince(phone, sinceMs) {
  const e = toE164(phone); if (!e) return 0;
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_guard_sent' }, { id: 'desc' }, 500);
    return (rows || []).filter((r) => toE164(metaOf(r).phone) === e && tsOf(r) >= sinceMs).length;
  } catch (_) { return 0; }
}

// De-dup: has this EXACT text already gone to this phone in the last window?
// Kills the two real duplicate-spam bugs (2026-07-11 audit): capture-callback's
// callback_ack re-fired up to 7× when the Vapi assistant re-invoked the tool in
// one call, and send-translated-reply double-fired (0.0min apart) on a Netlify
// retry. Both land here (both are customer-direction → guardedSend), so one
// idempotency check at the chokepoint fixes both. Exact phone+body match only, so
// it can never suppress a genuinely different message — just a literal duplicate.
const DEDUP_WINDOW_MS = (Number(process.env.SMS_DEDUP_WINDOW_MIN) > 0 ? Number(process.env.SMS_DEDUP_WINDOW_MIN) : 30) * 60 * 1000;
function bodyKey(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200); }
async function recentDuplicate(phone, message, windowMs) {
  const e = toE164(phone); if (!e) return false;
  const key = bodyKey(message);
  const since = Date.now() - (windowMs || DEDUP_WINDOW_MS);
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_guard_sent' }, { id: 'desc' }, 500);
    return (rows || []).some((r) => tsOf(r) >= since && toE164(metaOf(r).phone) === e && bodyKey(metaOf(r).body) === key);
  } catch (_) { return false; } // fail-open: a read error must never block a legit send
}
async function globalSentSince(sinceMs) {
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_guard_sent' }, { id: 'desc' }, 500);
    return (rows || []).filter((r) => tsOf(r) >= sinceMs).length;
  } catch (_) { return 0; }
}

async function xanoSend(to, body, tag) {
  try {
    const r = await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, body, message: body, context_tag: tag || 'ant_guarded' }) });
    const d = await r.json().catch(() => ({}));
    return !!(d && d.success);
  } catch (_) { return false; }
}

async function block(to, reason, kind, tag) { try { await crud.logEvent('sms_guard_blocked', { phone: to, reason, kind: kind || '', tag: tag || '', at_ms: Date.now() }); } catch (_) {} }
async function wouldBlock(to, reason, kind) { try { await crud.logEvent('sms_guard_would_block', { phone: to, reason, kind: kind || '', at_ms: Date.now() }); } catch (_) {} }

// The one safe customer send. Returns { sent, reason, shadow? }.
// 🚫 NO CLOCK TIMES TO CUSTOMERS (Teddy 2026-07-10, hard rule). We schedule by
// DAY + stop-position, never a promised time — a texted "3:00 PM" is a broken
// promise the second the route shifts. Scrub any clock time / arrival ETA out of
// every customer text at the chokepoint, so no matter which function composes one,
// the customer only ever gets the day-of-window language.
function scrubTimes(msg) {
  let s = String(msg || '');
  // "Expected arrival: 2:47pm CT" / "arrival window of 2-4" / "ETA 3pm" → the standard line
  s = s.replace(/\b(expected arrival|arrival (?:time|window)|your eta|eta)\b\s*:?\s*[^.!\n]*/gi, "we'll text a live arrival window the morning of");
  // ranges "between 2 and 4pm", "2-4 pm", "2 to 4 PM"
  s = s.replace(/\bbetween\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:and|to|-|–)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, 'that day');
  s = s.replace(/\b\d{1,2}(?::\d{2})?\s*(?:-|to|–)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, 'that day');
  // "at 3:00 PM", "at 3pm CT", "by 4 pm", "around 2:47pm"
  s = s.replace(/\b(?:at|by|around|approximately|about|for)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[a-z]{2,3})?/gi, '');
  // standalone "3:00 PM CT" / "2:47pm" / "3 PM"
  s = s.replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)(?:\s*[a-z]{2,3})?/gi, 'that day');
  s = s.replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, 'that day');
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

// ✅ The ONLY proactive customer texts we send (Teddy 2026-07-10: "we just need the
// intake and availability texts, kill the rest — it caused too many issues"):
//   1) intake links (shoot a video / model photo / quick check / finish upload)
//   2) availability asks (what days work)
// Everything else customer-direction — appointment confirmations, reminders,
// en-route/ETA/arrival, status updates, part-ordered, waivers, review/feedback
// requests — is PAUSED at the chokepoint. Reversible: set CUSTOMER_TEXTS_ALL=1
// to send everything again.
// Allowed = intake/availability + REACTIVE replies (never go silent on a customer
// who texts us — but scrubTimes still strips any clock time from those replies).
// PLUS tech_field: a human TECH deliberately texting his own live-job customer
// (model/serial photo, "are you home?"). Not automated spam — a person doing the
// job — so it passes the intake-only pause, while opt-out / dedup / quiet-hours /
// no-clock-times all still apply at the chokepoint. (Lee 2026-07-14.)
// 'satisfaction' covers the whole review flow (satisfaction_check ask + the 👍→Google-
// review-link reply + the 👎→private-feedback capture). Re-enabled 2026-07-21 (Teddy: go
// hard on the map pack — a 👍 is a likely positive reviewer). Opt-out / quiet-hours / dedup
// / frequency caps all STILL apply at the chokepoint below — this only lifts the pause.
const INTAKE_OK = /intake|availab|quick.?check|finish.?upload|\bmedia\b|shoot|model.?photo|\bvideo\b|new.?lead|resume|book.?media|reply|response|answer|translated|inbound|tech.?field|satisfaction/i;
function isIntakeOrAvailability(kind, tag) {
  if (String(process.env.CUSTOMER_TEXTS_ALL || '') === '1') return true;   // re-enable all
  return INTAKE_OK.test(((kind || '') + ' ' + (tag || '')));
}

async function guardedSend({ phone, message, tag, kind, allowQuiet }) {
  const to = toE164(phone);
  message = scrubTimes(message);   // strip any promised clock time before anything else
  if (!to || to.length < 12 || !message) return { sent: false, reason: 'bad_input' };

  // 0. INTAKE-ONLY MODE — pause every proactive customer text except intake/availability.
  if (!isIntakeOrAvailability(kind, tag)) {
    try { await crud.logEvent('sms_paused_intake_only', { phone: to, kind: kind || '', tag: tag || '', at_ms: Date.now() }); } catch (_) {}
    return { sent: false, reason: 'customer_texts_paused' };
  }

  // 1. OPT-OUT — absolute, always enforced (even before SMS_GUARD_ENFORCE).
  if (await isOptedOut(to)) { await block(to, 'opted_out', kind, tag); return { sent: false, reason: 'opted_out' }; }

  const now = Date.now();

  // 2. QUIET HOURS — HARD block for customers, ALWAYS (not gated on ENFORCE).
  // A 3:30am text is indefensible: TCPA exposure AND it wakes real people up
  // (a real customer got one 2026-07-06). There is no legitimate proactive
  // customer text outside 8am–9pm CT. allowQuiet still lets the same-day
  // en-route/ETA texts the customer is actively expecting through. Blocking a
  // night send is always correct — the daytime touchpoints re-reach them.
  if (!allowQuiet && inQuietHours()) {
    await block(to, 'quiet_hours', kind, tag);
    return { sent: false, reason: 'quiet_hours' };
  }

  // 2.5. DUPLICATE SUPPRESSION — ALWAYS on (not gated on ENFORCE). If this exact
  // text already went to this phone within the dedup window, it's a re-fire, not a
  // new message. Kills the callback_ack burst (Vapi re-invoking capture_callback)
  // and the translated_reply double-send (Netlify retry). Exact phone+body match,
  // so a genuinely different message is never suppressed.
  if (await recentDuplicate(to, message, DEDUP_WINDOW_MS)) {
    try { await crud.logEvent('sms_dup_suppressed', { phone: to, kind: kind || '', tag: tag || '', body: message.slice(0, 160), at_ms: now }); } catch (_) {}
    return { sent: false, reason: 'duplicate_suppressed' };
  }

  // 3–4. Frequency / global rate — hard-block only when ENFORCE=1; otherwise
  // shadow-log so we can see the impact before flipping it on.
  const checks = [];
  if ((await sentSince(to, now - 86400000)) >= CAP_24H) checks.push('cap_24h');
  if ((await sentSince(to, now - 7 * 86400000)) >= CAP_7D) checks.push('cap_7d');
  if ((await globalSentSince(now - 600000)) >= GLOBAL_10MIN) checks.push('global_rate');

  if (checks.length) {
    if (ENFORCE) { await block(to, checks[0], kind, tag); return { sent: false, reason: checks[0] }; }
    await wouldBlock(to, checks.join('+'), kind);   // shadow — still send below
  }

  // 5. Send + record (record drives the frequency counters).
  const ok = await xanoSend(to, message, tag);
  if (ok) { try { await crud.logEvent('sms_guard_sent', { phone: to, kind: kind || '', tag: tag || '', body: message.slice(0, 200), at_ms: now }); } catch (_) {} }
  return { sent: ok, reason: ok ? (checks.length ? 'sent_shadow' : 'sent') : 'send_failed', shadow: checks.length ? checks : undefined };
}

module.exports = {
  scrubTimes,
  toE164, isStop, isStart, inQuietHours, isOptedOut, recordOptOut, clearOptOut,
  guardedSend, sentSince, globalSentSince, recentDuplicate,
  ENFORCE, CAP_24H, CAP_7D, GLOBAL_10MIN, QUIET_START, QUIET_END,
};
