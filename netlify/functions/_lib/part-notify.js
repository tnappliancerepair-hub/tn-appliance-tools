// part-notify — the one place that texts a customer "we ordered your part,
// here's the ETA, what's your availability after that?" Called the instant a
// part is marked ordered (mark-parts-ordered), so the message is immediate and
// forward-only — it only ever fires for the job just ordered, never a backlog.
//
// SAFE: guardedSend (opt-out absolute, quiet-hours/caps), dedupe one text per
// job, and SHADOW until PART_ORDERED_NOTIFY_LIVE=true (a plain call logs what it
// WOULD send and sends nothing). Teddy 2026-07-03.
'use strict';

const guard = require('./sms-guard');
const crud = require('./xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const LIVE = String(process.env.PART_ORDERED_NOTIFY_LIVE || '').toLowerCase() === 'true';

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

function etaPhrase(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const dt = new Date(s.length <= 10 ? s + 'T12:00:00' : s);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' });
}

// Part ordered + ETA + the availability ask (so we can book the 2nd visit the
// moment it lands). Shared with the backup watcher so wording stays identical.
function orderMessage(name, appliance, etaRaw) {
  const who = String(name || '').trim() || 'there';
  const what = String(appliance || 'appliance').toLowerCase();
  const eta = etaPhrase(etaRaw);
  if (eta) {
    return `Hi ${who}, it's Tennessee Appliance — good news, we've ordered the part for your ${what} repair. It's expected to arrive around ${eta}. As soon as it's in we'll get you scheduled. To make that quick: what days and times work best for you after ${eta}, and are there any that DON'T? Just reply here and we'll lock in your visit. Thanks!`;
  }
  return `Hi ${who}, it's Tennessee Appliance — good news, we've ordered the part for your ${what} repair and we're tracking its arrival. The moment it's in we'll reach out to get you scheduled. To make that quick: what days and times generally work for you, and any that DON'T? Just reply here and we'll get you set. Thanks!`;
}

async function alreadyNotified(jobId) {
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'proactive_parts_notified' }, { id: 'desc' }, 2000);
    return rows.some((r) => String(metaOf(r).job_id || '') === String(jobId));
  } catch (_) { return false; }
}

// Fire the "part ordered" text for one job. eta_date optional (falls back to the
// job's parts_eta_date). Returns { ok, reason, would_send? }.
async function notifyPartOrdered({ job_id, eta_date }) {
  if (!job_id) return { ok: false, reason: 'no_job' };
  if (await alreadyNotified(job_id)) return { ok: false, reason: 'already_notified' };

  // pull the customer's name/phone + appliance for the message
  let name = 'there', phone = '', appliance = 'appliance', eta = eta_date || '';
  try {
    const d = await (await fetch(`${XANO}/get_job_for_dashboard`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id }),
    })).json();
    const c = (d && d.customer) || {}, a = (d && d.appliance) || {}, j = (d && d.job) || {};
    name = (c.first_name || '').trim() || (c.name || '').trim().split(/\s+/)[0] || 'there';
    phone = c.phone || '';
    appliance = (a.type || a.appliance_type || 'appliance');
    if (!eta) eta = j.parts_eta_date || '';
  } catch (_) {}
  if (!phone) return { ok: false, reason: 'no_phone' };

  const message = orderMessage(name, appliance, eta);

  // LIVE from here forward (Teddy 2026-07-03): every part Danielle orders texts
  // that customer immediately. Safe to be always-on — it fires only for the one
  // job just ordered (never a backlog), dedupes one-per-job, and guardedSend
  // still enforces opt-out absolutely (+ quiet-hours/caps). Set
  // PART_ORDERED_NOTIFY_LIVE=false only if you ever need to hard-pause it.
  if (String(process.env.PART_ORDERED_NOTIFY_LIVE || '').toLowerCase() === 'false') {
    try { await crud.logEvent('part_ordered_notify_paused', { job_id, phone: guard.toE164(phone), at_ms: Date.now() }); } catch (_) {}
    return { ok: false, reason: 'paused' };
  }
  // tag carries 'availab' so the message (an availability ask) passes the intake-only
  // gate — the exact fix for the audit's silent drop. Teddy re-armed this one text
  // deliberately (valuable) while everything else stays gated. 2026-07-17.
  const res = await guard.guardedSend({ phone, message, tag: 'part_ordered_availability_request', kind: 'status_update' });
  if (res.reason !== 'send_failed') {
    try { await crud.logEvent('proactive_parts_notified', { job_id, phone: guard.toE164(phone), eta: String(eta || ''), at_ms: Date.now(), reason: res.reason, via: 'order_hook' }); } catch (_) {}
  }
  return { ok: res.sent, reason: res.reason };
}

// ── Part ARRIVED (Teddy 2026-07-17) ──────────────────────────────────────────
// ONE availability text when the part lands, deduped HARD across EVERY arrival
// signal — multiple carrier/vendor "delivered" emails, the customer texting
// "it's here", and the customer calling all funnel through here and produce
// exactly ONE send. Also drops a board flag so the office board shows the
// green->red "PART IN — SCHEDULE NOW" ribbon. No text to the office (the board
// is the alert). At-most-once by design: we claim the marker BEFORE sending, so
// "only ever one" wins over "guaranteed retry" — exactly what Teddy asked for.
function arrivedMessage(name, appliance, haveAvail) {
  const who = String(name || '').trim() || 'there';
  const what = String(appliance || 'appliance').toLowerCase();
  if (haveAvail) {
    return `Hi ${who}, it's TN Appliance Exchange \u{1F41C} — great news, the part for your ${what} arrived and we've got your availability! We'll get you back on the schedule and text to confirm your day. Thanks!`;
  }
  return `Hi ${who}, it's TN Appliance Exchange \u{1F41C} — we're glad the part for your ${what} arrived! When are you available over the next few days to get your tech back out to finish up? Just reply: Wide open · Mornings · or After 12, and we'll lock in your visit.`;
}

async function hasJobMarker(action, jobId) {
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, 2000);
    return rows.some((r) => String(metaOf(r).job_id || '') === String(jobId));
  } catch (_) { return false; }
}

// Idempotent board flag — the ribbon shows regardless of the text outcome
// (opt-out, no phone, send fail). Written once per job.
async function ensureArrivedFlag(jobId, via) {
  if (await hasJobMarker('part_arrived_ready', jobId)) return;
  try { await crud.logEvent('part_arrived_ready', { job_id: jobId, arrived_at: Date.now(), via: via || 'unknown' }); } catch (_) {}
}

// The single funnel every arrival trigger calls. Guarantees one text per job.
async function notifyPartArrived({ job_id, via, haveAvailability }) {
  if (!job_id) return { ok: false, reason: 'no_job' };
  await ensureArrivedFlag(job_id, via);                 // board siren always
  if (await hasJobMarker('part_arrived_availability_sent', job_id)) return { ok: false, reason: 'already_texted', flagged: true };
  // Claim BEFORE sending so a near-simultaneous second trigger can't double-send.
  try { await crud.logEvent('part_arrived_availability_sent', { job_id, via: via || 'unknown', at_ms: Date.now(), claimed: true }); } catch (_) {}

  let name = 'there', phone = '', appliance = 'appliance';
  try {
    const d = await (await fetch(`${XANO}/get_job_for_dashboard`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id }),
    })).json();
    const c = (d && d.customer) || {}, a = (d && d.appliance) || {};
    name = (c.first_name || '').trim() || (c.name || '').trim().split(/\s+/)[0] || 'there';
    phone = c.phone || '';
    appliance = (a.type || a.appliance_type || 'appliance');
  } catch (_) {}
  if (!phone) return { ok: false, reason: 'no_phone', flagged: true };

  // tag carries 'availab' so this passes the intake-only gate (audit-safe).
  const res = await guard.guardedSend({ phone, message: arrivedMessage(name, appliance, haveAvailability), tag: 'part_arrived_availability_reply', kind: 'status_update' });
  try { await crud.logEvent('part_arrived_notified', { job_id, phone: guard.toE164(phone), via: via || 'unknown', reason: res.reason, at_ms: Date.now() }); } catch (_) {}
  return { ok: res.sent, reason: res.reason, flagged: true };
}

module.exports = { notifyPartOrdered, notifyPartArrived, ensureArrivedFlag, orderMessage, arrivedMessage, etaPhrase, LIVE };
