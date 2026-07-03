// proactive-status-sms — tell customers their status BEFORE they call to ask.
//
// Today's call log (2026-07-03) showed the #1 driver of repeat calls is
// "where's my part / is it scheduled" — customers calling 2–3× while they wait.
// This texts an awaiting-parts customer ONCE, proactively: "your part's on
// order, ETA X, we'll reach out to schedule — nothing you need to do." That
// single touch kills most of the "where's my part" calls.
//
// SAFE BY DESIGN:
//   • guardedSend — opt-out is absolute; quiet-hours/frequency/global caps apply.
//   • ONE text per job (a `proactive_parts_notified` marker dedupes forever).
//   • THROTTLED per run so the current backlog drains over a few runs, never a blast.
//   • SHADOW by default — it computes + logs what it WOULD send but sends nothing
//     until PROACTIVE_STATUS_LIVE=true (or a manual ?send=1&secret= run). Preview
//     any time with ?dry=1.
'use strict';

const guard = require('./_lib/sms-guard');
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const LIVE = String(process.env.PROACTIVE_STATUS_LIVE || '').toLowerCase() === 'true';
const MAX_PER_RUN = Number(process.env.PROACTIVE_STATUS_MAX_PER_RUN) > 0 ? Number(process.env.PROACTIVE_STATUS_MAX_PER_RUN) : 12;
const ADMIN = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(o, code) { return { statusCode: code || 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function firstName(j) { return String(j.customer_first || j.customer_first_name || '').trim() || 'there'; }
function appl(j) { return String(j.appliance || j.appliance_type || 'appliance').toLowerCase(); }

// Pull every job object out of the kanban structure (dedupe by id).
function collectJobs(d) {
  const out = {}; (function walk(o) {
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (o && typeof o === 'object') {
      if (o.id != null && 'scheduling_status' in o) out[o.id] = o;
      for (const v of Object.values(o)) walk(v);
    }
  })(d);
  return Object.values(out);
}

// Friendly ETA phrase, or '' when we don't have a real date.
function etaPhrase(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const dt = new Date(s.length <= 10 ? s + 'T12:00:00' : s);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' });
}

function partsMessage(j) {
  const eta = etaPhrase(j.parts_eta_date);
  const who = firstName(j), what = appl(j);
  if (eta) {
    return `Hi ${who}, it's Tennessee Appliance with an update on your ${what} repair. Your part is on order — expected around ${eta}. As soon as it arrives we'll reach right out to get your visit scheduled. Nothing you need to do on your end, we're tracking it for you. Questions anytime? Just reply here.`;
  }
  return `Hi ${who}, it's Tennessee Appliance with an update on your ${what} repair. Your part is on order and we're tracking it. The moment it comes in we'll reach out to get your visit scheduled — nothing you need to do on your end, we've got it. Questions anytime? Just reply here.`;
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dry === '1';
  const manualSend = q.send === '1' && q.secret === ADMIN;
  const willSend = manualSend || (LIVE && !dry);
  const cap = Number(q.max) > 0 ? Number(q.max) : MAX_PER_RUN;

  // 1) active jobs
  let jobs = [];
  try { jobs = collectJobs(await (await fetch(`${XANO}/get_office_kanban`)).json()); }
  catch (_) { return json({ ok: false, error: 'kanban_fetch_failed' }); }

  // 2) jobs we've already proactively notified (dedupe forever, one text per job)
  const notified = new Set();
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'proactive_parts_notified' }, { id: 'desc' }, 1000);
    for (const r of rows) { const jid = String(metaOf(r).job_id || ''); if (jid) notified.add(jid); }
  } catch (_) {}

  // 3) candidates = genuinely waiting on parts, have a phone, not yet notified
  const candidates = jobs.filter((j) => {
    const waiting = String(j.scheduling_status || '') === 'awaiting_parts';
    const notArrived = String(j.parts_status || '') !== 'arrived';
    const hasPhone = !!String(j.customer_phone || '').trim();
    return waiting && notArrived && hasPhone && !notified.has(String(j.id));
  });

  const results = []; let sent = 0;
  for (const j of candidates) {
    if (sent >= cap) break;
    const msg = partsMessage(j);
    if (!willSend) { results.push({ job_id: j.id, name: firstName(j), appliance: appl(j), eta: etaPhrase(j.parts_eta_date) || null, preview: msg }); sent++; continue; }
    const res = await guard.guardedSend({ phone: j.customer_phone, message: msg, tag: 'proactive_parts_status', kind: 'status_update' });
    // Mark notified whenever the guard didn't hard-block for a retryable reason —
    // sent OR shadow-sent OR opted-out (don't keep retrying an opt-out). Only a
    // send_failed leaves it un-marked so the next run retries.
    if (res.reason !== 'send_failed') { try { await crud.logEvent('proactive_parts_notified', { job_id: j.id, phone: guard.toE164(j.customer_phone), state: etaPhrase(j.parts_eta_date) ? 'eta' : 'pending', at_ms: Date.now(), reason: res.reason }); } catch (_) {} }
    results.push({ job_id: j.id, sent: res.sent, reason: res.reason });
    if (res.sent) sent++;
  }

  return json({
    ok: true,
    mode: willSend ? 'LIVE' : (dry ? 'dry_preview' : 'shadow'),
    live_flag: LIVE,
    total_jobs: jobs.length,
    awaiting_parts_candidates: candidates.length,
    processed: results.length,
    sent,
    cap,
    results: results.slice(0, 60),
  });
};
