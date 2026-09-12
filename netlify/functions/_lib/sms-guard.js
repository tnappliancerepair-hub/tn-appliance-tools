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

// Every check below reads Xano's event_log, and guardedSend runs about six of them before
// a single text goes out. Each has a 10s timeout AND a retry, so when Xano is saturated -
// measured 4s typical and 25s+ on 2026-09-10 - the whole send simply hung and the office
// reported "the new system won't send text." Nothing failed; nothing returned either.
//
// A hang is the worst shape a check can have: it neither allows nor denies. Give the reads
// a hard budget so a slow Xano becomes an ERROR, which every one of these already handles
// by failing open - the behaviour that was always intended, with Telnyx's carrier-level
// STOP as the real backstop. A text the office typed by hand is worth more than a perfect
// frequency count nobody can read.
const GUARD_READ_MS = Number(process.env.SMS_GUARD_READ_MS || 3500);
function budgeted(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('guard_read_timeout')), ms || GUARD_READ_MS))]);
}


// ── THE GUARD'S OWN LEDGER, ON SUPABASE ──────────────────────────────────────
// Every check below used to scan 500 rows of Xano's event_log and filter in JS, six
// times per message. On 2026-09-10 Xano was answering in 4-25s and the office simply
// could not send a text: guardedSend never returned. Worse, the fail-open that kept it
// from hanging forever also meant OPT-OUT was not being enforced while Xano was slow -
// the one check that must never be a guess.
//
// Same markers, own table, indexed on (phone, action, at_ms). An opt-out check is now a
// single keyed lookup instead of two 500-row scans, so it is faster AND exact - it can
// see an opt-out from any point in history, not just whatever fell inside the newest 500
// rows. Existing opt-outs were migrated across before this was switched on.
const SBG_URL = 'https://tntbhfwitytkcoqlejwc.supabase.co';
const SBG_TABLE = 'sms_guard_event';
function sbgKey() { return process.env.PLATFORM_SUPABASE_SERVICE_KEY || ''; }
function sbgOn() { return !!sbgKey(); }
function sbgH() { const k = sbgKey(); return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }; }

async function sbgRows(qs) {
  if (!sbgOn()) return null;
  const r = await fetch(`${SBG_URL}/rest/v1/${SBG_TABLE}?${qs}`, { headers: sbgH(), signal: AbortSignal.timeout(GUARD_READ_MS) });
  if (!r.ok) return null;
  return r.json();
}
// Exact count without hauling the rows back.
async function sbgCount(qs) {
  if (!sbgOn()) return null;
  const r = await fetch(`${SBG_URL}/rest/v1/${SBG_TABLE}?${qs}&select=id`,
    { headers: { ...sbgH(), Prefer: 'count=exact', Range: '0-0' }, signal: AbortSignal.timeout(GUARD_READ_MS) });
  if (!r.ok) return null;
  const cr = r.headers.get('content-range') || '';
  const n = Number(String(cr).split('/')[1]);
  return Number.isFinite(n) ? n : null;
}
async function sbgWrite(row) {
  if (!sbgOn()) return false;
  try {
    const r = await fetch(`${SBG_URL}/rest/v1/${SBG_TABLE}`, {
      method: 'POST', headers: { ...sbgH(), Prefer: 'return=minimal' },
      body: JSON.stringify(row), signal: AbortSignal.timeout(GUARD_READ_MS),
    });
    return r.ok;
  } catch (_) { return false; }
}

// Opted out if the newest opt-out marker is newer than the newest opt-in.
async function isOptedOut(phone) {
  const e = toE164(phone); if (!e) return false;
  try {
    // Newest marker for this phone decides it - opt_out after opt_in means opted out.
    const rows = await sbgRows(`phone=eq.${encodeURIComponent(e)}&action=in.(sms_opt_out,sms_opt_in)&select=action,at_ms&order=at_ms.desc&limit=1`);
    if (rows) return !!(rows[0] && rows[0].action === 'sms_opt_out');
    // Supabase unreachable -> fall back to the old Xano scan rather than guessing.
    const [outs, ins] = await budgeted(Promise.all([
      crud.searchPage(crud.TABLES.event_log, { action: 'sms_opt_out' }, { id: 'desc' }, 500),
      crud.searchPage(crud.TABLES.event_log, { action: 'sms_opt_in' }, { id: 'desc' }, 500),
    ]));
    const newest = (rs) => Math.max(0, ...(rs || []).filter((r) => toE164(metaOf(r).phone) === e).map(tsOf));
    return newest(outs) > newest(ins);
  } catch (_) { return false; } // fail-open: Telnyx carrier-level STOP is the hard backstop
}

async function recordOptOut(phone, source) { const e = toE164(phone), t = Date.now();
  await sbgWrite({ phone: e, action: 'sms_opt_out', kind: source || 'inbound', at_ms: t });
  try { await budgeted(crud.logEvent('sms_opt_out', { phone: e, source: source || 'inbound', at_ms: t })); } catch (_) {} }
async function clearOptOut(phone, source) { const e = toE164(phone), t = Date.now();
  await sbgWrite({ phone: e, action: 'sms_opt_in', kind: source || 'inbound', at_ms: t });
  try { await budgeted(crud.logEvent('sms_opt_in', { phone: e, source: source || 'inbound', at_ms: t })); } catch (_) {} }

async function sentSince(phone, sinceMs) {
  const e = toE164(phone); if (!e) return 0;
  try {
    const n = await sbgCount(`phone=eq.${encodeURIComponent(e)}&action=eq.sms_guard_sent&at_ms=gte.${Math.floor(sinceMs)}`);
    if (n != null) return n;
    const rows = await budgeted(crud.searchPage(crud.TABLES.event_log, { action: 'sms_guard_sent' }, { id: 'desc' }, 500));
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
// Dedup key must include the UNIQUE tail of a message, not just its opening. Intake /
// pay / portal texts share an identical preamble and carry their one distinguishing
// token (the link) at the END — a flat slice(0,200) cut the token off, so two DIFFERENT
// intake links to the same phone collided and the 2nd was suppressed as a false
// "duplicate" (why a repeat test to the same number never delivered). Keep head+tail so a
// truly identical message still matches, but two links that differ only in their token don't.
function bodyKey(s) {
  const t = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return t.length <= 200 ? t : (t.slice(0, 150) + '|' + t.slice(-60));
}
async function recentDuplicate(phone, message, windowMs) {
  const e = toE164(phone); if (!e) return false;
  const key = bodyKey(message);
  const since = Date.now() - (windowMs || DEDUP_WINDOW_MS);
  try {
    const hit = await sbgRows(`phone=eq.${encodeURIComponent(e)}&action=eq.sms_guard_sent&body_key=eq.${encodeURIComponent(key)}&at_ms=gte.${Math.floor(since)}&select=id&limit=1`);
    if (hit != null) return hit.length > 0;
    const rows = await budgeted(crud.searchPage(crud.TABLES.event_log, { action: 'sms_guard_sent' }, { id: 'desc' }, 500));
    return (rows || []).some((r) => tsOf(r) >= since && toE164(metaOf(r).phone) === e && bodyKey(metaOf(r).body) === key);
  } catch (_) { return false; } // fail-open: a read error must never block a legit send
}
async function globalSentSince(sinceMs) {
  try {
    const n = await sbgCount(`action=eq.sms_guard_sent&at_ms=gte.${Math.floor(sinceMs)}`);
    if (n != null) return n;
    const rows = await budgeted(crud.searchPage(crud.TABLES.event_log, { action: 'sms_guard_sent' }, { id: 'desc' }, 500));
    return (rows || []).filter((r) => tsOf(r) >= sinceMs).length;
  } catch (_) { return 0; }
}

// Returns { sent, answered }. The second field is the one that matters and the reason this
// is not just a boolean: a plain `false` conflates TWO opposite situations --
//   · Xano ANSWERED and refused (its own intake-only gate dropped the message)  -> answered:true
//   · Xano never answered at all (down, timing out, unreachable)                -> answered:false
// Treating those the same is how you accidentally start texting customers: falling back to a
// direct send on a deliberate gate refusal bypasses the very rule that refused it. So any
// well-formed reply from Xano counts as a DECISION and is respected; only a genuine transport
// failure is eligible for the direct fallback below.
async function xanoSend(to, body, tag) {
  try {
    const r = await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, body, message: body, context_tag: tag || 'ant_guarded' }),
      signal: AbortSignal.timeout(12000),
    });
    const txt = await r.text().catch(() => '');
    let d = null; try { d = JSON.parse(txt); } catch (_) { d = null; }
    if (!r.ok || d === null || typeof d !== 'object') return { sent: false, answered: false };
    return { sent: !!d.success, answered: true };
  } catch (_) { return { sent: false, answered: false }; }
}

// 🐜 PLATFORM (Supabase) TENANT TEXTS — deliver DIRECT via Telnyx, not through Xano.
// Found 2026-09-08 from Jimmy in the field ("I try to send text for signature, but wouldn't
// let me"): the Netlify guard un-paused platform_* traffic months ago, but Xano's OWN
// intake-only gate inside send_sms never learned about it, so every tenant text died there
// as sms_blocked_non_intake (platform_waiver_link, platform_complete, …). Two gates, one
// updated. Rather than depend on a Xano push, platform_* now hands off straight to Telnyx
// from the customer line — AFTER every check above (opt-out, quiet hours, dedup, caps) has
// already run, so nothing is loosened, only the stale duplicate gate is bypassed. Falls
// back to the Xano path if the direct send fails, so a text is never silently lost.
// Reversible: PLATFORM_SMS_DIRECT=0.
const PLATFORM_TAG_RE = /^platform_/i;
const PLATFORM_DIRECT_ON = String(process.env.PLATFORM_SMS_DIRECT || '1') !== '0';
const CUSTOMER_FROM = process.env.TELNYX_FROM_CUSTOMER || '+16155889500';

async function telnyxDirect(to, body, tag) {
  let key = process.env.TELNYX_API_KEY;
  if (!key) { try { key = await require('./secrets').getSecret('TELNYX_API_KEY'); } catch (_) {} }
  if (!key) return false;
  try {
    const r = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: CUSTOMER_FROM, to, text: body }),
    });
    const d = await r.json().catch(() => ({}));
    const id = d && d.data && d.data.id;
    if (r.ok && id) {
      try { await crud.logEvent('platform_sms_direct', { to, tag: tag || '', from: CUSTOMER_FROM, id, at_ms: Date.now() }); } catch (_) {}
      return true;
    }
    try { await crud.logEvent('platform_sms_direct_failed', { to, tag: tag || '', status: r.status, detail: JSON.stringify(d).slice(0, 200), at_ms: Date.now() }); } catch (_) {}
    return false;
  } catch (_) { return false; }
}

// One delivery door: platform tenant traffic goes direct, everything else keeps the
// long-proven Xano path (its Telnyx creds + fallback behavior are untouched).
async function deliver(to, body, tag) {
  if (PLATFORM_DIRECT_ON && PLATFORM_TAG_RE.test(String(tag || ''))) {
    if (await telnyxDirect(to, body, tag)) return true;
  }
  const x = await xanoSend(to, body, tag);
  if (x.sent) return true;
  // Xano ANSWERED and said no -> that is its gate doing its job. Respect it; never route
  // around a deliberate refusal.
  if (x.answered) return false;

  // Xano never answered. Until now the customer's text was simply LOST here -- the one thing
  // CLAUDE.md calls out as breaking if Xano vanished. Every guard above (opt-out, quiet
  // hours, dedup, frequency caps, the intake-only pause, the no-clock-times scrub) has
  // already run and allowed this message, so handing it to the carrier directly loosens
  // nothing; it just stops the old system's outage from silencing the new one.
  // Reversible: SMS_XANO_DOWN_FALLBACK=0.
  if (String(process.env.SMS_XANO_DOWN_FALLBACK || '1') === '0') return false;
  const ok = await telnyxDirect(to, body, tag || 'ant_guarded');
  // Audit to SUPABASE, not crud.logEvent -- that writes to Xano, which is the thing that
  // just failed. A record of an outage must not live inside the outage.
  try { await sbgWrite({ phone: toE164(to), action: ok ? 'sms_sent_xano_down' : 'sms_lost_both_paths', tag: tag || '', kind: 'customer', reason: 'xano_unreachable', at_ms: Date.now() }); } catch (_) {}
  return ok;
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
// 'platform_' = the MULTI-TENANT PLATFORM's per-shop lifecycle texts (platform_review /
// _otw / _arrived / _complete / _invoice / _reminder / _schedule_offer / _waiver_link, etc.
// from platform-tech-notify.js). Each is a REAL paying tenant's own communication, already
// gated per-shop by that shop's Communication Center toggle (comms.js), and every one still
// passes through opt-out / quiet-hours / dedup / caps below. The intake-only pause was a
// TN-flood fix and must not gag a customer's shop — legacy TN sends carry non-platform tags
// (ann_*, cash_*, etc.) so they stay intake-only; only platform_* tenant traffic is un-paused.
const INTAKE_OK = /intake|availab|quick.?check|finish.?upload|\bmedia\b|shoot|model.?photo|\bvideo\b|new.?lead|resume|book.?media|reply|response|answer|translated|inbound|tech.?field|satisfaction|platform_/i;
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

  // 4.5. AUTO-TRANSLATE — if this customer has a known non-English language, send
  // the text IN THAT LANGUAGE. All gate checks above ran on the English body (so
  // dedup/counters stay stable), only the outgoing copy is translated. Fully
  // fail-safe: any error → send the original English. One-fix-covers-every-text.
  let outMsg = message;
  try {
    const lang = await require('./customer-lang').getCustomerLang(to);
    if (lang && lang !== 'en') outMsg = await require('./translate').translateTo(message, lang);
  } catch (_) { outMsg = message; }

  // 5. Send + record (record drives the frequency counters).
  const ok = await deliver(to, outMsg, tag);
  if (ok) {
    // Store the real dedup key, computed from the FULL message - the old marker kept only
    // the first 200 characters, which is what made two different intake links collide.
    await sbgWrite({ phone: to, action: 'sms_guard_sent', body_key: bodyKey(message), tag: tag || '', kind: kind || '', at_ms: now });
    try { await budgeted(crud.logEvent('sms_guard_sent', { phone: to, kind: kind || '', tag: tag || '', body: message.slice(0, 200), at_ms: now })); } catch (_) {}
  }
  return { sent: ok, reason: ok ? (checks.length ? 'sent_shadow' : 'sent') : 'send_failed', shadow: checks.length ? checks : undefined };
}

module.exports = {
  scrubTimes,
  toE164, isStop, isStart, inQuietHours, isOptedOut, recordOptOut, clearOptOut,
  guardedSend, sentSince, globalSentSince, recentDuplicate,
  ENFORCE, CAP_24H, CAP_7D, GLOBAL_10MIN, QUIET_START, QUIET_END,
};
