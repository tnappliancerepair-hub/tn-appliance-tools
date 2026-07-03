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
  const res = await guard.guardedSend({ phone, message, tag: 'part_ordered_notify', kind: 'status_update' });
  if (res.reason !== 'send_failed') {
    try { await crud.logEvent('proactive_parts_notified', { job_id, phone: guard.toE164(phone), eta: String(eta || ''), at_ms: Date.now(), reason: res.reason, via: 'order_hook' }); } catch (_) {}
  }
  return { ok: res.sent, reason: res.reason };
}

module.exports = { notifyPartOrdered, orderMessage, etaPhrase, LIVE };
