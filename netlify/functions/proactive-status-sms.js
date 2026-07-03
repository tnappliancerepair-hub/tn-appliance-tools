// proactive-status-sms — when we ORDER a part, tell the customer right away:
// "part's ordered, ETA is X — what days work for you after that?" It captures
// their availability at the perfect moment so we can book them the moment the
// part lands, and it kills the "where's my part / is it scheduled" call.
//
// FORWARD-ONLY BY DESIGN (Teddy 2026-07-03): it never touches the stale backlog.
// A one-time ?baseline= marks every job that's ALREADY awaiting-parts as
// "handled" without texting, so only jobs that enter awaiting-parts from now on
// get the message. A sanity guard refuses to send if it ever sees a big batch of
// un-notified jobs (i.e. the backlog wasn't baselined) so it can't blast.
//
// SAFE: guardedSend (opt-out absolute, quiet-hours/caps), one text per job
// (dedupe marker), throttled per run. SHADOW until PART_ORDERED_NOTIFY_LIVE=true
// (or a manual ?send=1&secret= run). Preview any time with ?dry=1.
'use strict';

const guard = require('./_lib/sms-guard');
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const LIVE = String(process.env.PART_ORDERED_NOTIFY_LIVE || '').toLowerCase() === 'true';
const MAX_PER_RUN = Number(process.env.PART_ORDERED_MAX_PER_RUN) > 0 ? Number(process.env.PART_ORDERED_MAX_PER_RUN) : 8;
const SANITY_MAX = Number(process.env.PART_ORDERED_SANITY_MAX) > 0 ? Number(process.env.PART_ORDERED_SANITY_MAX) : 15;
const ADMIN = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(o, code) { return { statusCode: code || 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function firstName(j) { return String(j.customer_first || j.customer_first_name || '').trim() || 'there'; }
function appl(j) { return String(j.appliance || j.appliance_type || 'appliance').toLowerCase(); }

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

function etaPhrase(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const dt = new Date(s.length <= 10 ? s + 'T12:00:00' : s);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' });
}

// Part ordered + ETA + the availability ask (so we book them right after the part lands).
function orderMessage(j) {
  const eta = etaPhrase(j.parts_eta_date);
  const who = firstName(j), what = appl(j);
  if (eta) {
    return `Hi ${who}, it's Tennessee Appliance — good news, we've ordered the part for your ${what} repair. It's expected to arrive around ${eta}. As soon as it's in we'll get you scheduled. To make that quick: what days and times work best for you after ${eta}, and are there any that DON'T work? Just reply here and we'll lock in your visit. Thanks!`;
  }
  return `Hi ${who}, it's Tennessee Appliance — good news, we've ordered the part for your ${what} repair and we're tracking its arrival. The moment it's in we'll reach out to get you scheduled. To make that quick: what days and times generally work for you, and any that DON'T? Just reply here and we'll get you set. Thanks!`;
}

async function markNotified(j, reason) {
  try { await crud.logEvent('proactive_parts_notified', { job_id: j.id, phone: guard.toE164(j.customer_phone), eta: String(j.parts_eta_date || ''), at_ms: Date.now(), reason: reason || '' }); } catch (_) {}
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const authed = q.secret === ADMIN;
  const dry = q.dry === '1';
  const baseline = q.baseline === '1' && authed;   // silence the current backlog (no texts)
  const manualSend = q.send === '1' && authed;
  const force = q.force === '1' && authed;
  const willSend = !baseline && !dry && (manualSend || LIVE);

  // active jobs
  let jobs = [];
  try { jobs = collectJobs(await (await fetch(`${XANO}/get_office_kanban`)).json()); }
  catch (_) { return json({ ok: false, error: 'kanban_fetch_failed' }); }

  // already-handled set (dedupe forever — one text per job)
  const notified = new Set();
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'proactive_parts_notified' }, { id: 'desc' }, 2000);
    for (const r of rows) { const jid = String(metaOf(r).job_id || ''); if (jid) notified.add(jid); }
  } catch (_) {}

  // candidates: genuinely awaiting a part, has a phone, not yet handled
  const candidates = jobs.filter((j) => String(j.scheduling_status || '') === 'awaiting_parts'
    && String(j.parts_status || '') !== 'arrived'
    && !!String(j.customer_phone || '').trim()
    && !notified.has(String(j.id)));

  // BASELINE: mark all current candidates handled, send nothing (run once at go-live).
  if (baseline) {
    for (const j of candidates) await markNotified(j, 'baseline');
    return json({ ok: true, mode: 'baseline', baselined: candidates.length });
  }

  // SANITY GUARD: a big un-notified batch means the backlog wasn't baselined —
  // refuse to send so we can't blast. (Override with &force=1 once intended.)
  if (willSend && candidates.length > SANITY_MAX && !force) {
    return json({ ok: false, mode: 'refused_needs_baseline', un_notified: candidates.length,
      hint: `Run ?baseline=1&secret=… once to silence the backlog, then only NEW part orders get texted. (or &force=1 to override)` });
  }

  const results = []; let sent = 0;
  for (const j of candidates) {
    if (sent >= MAX_PER_RUN) break;
    const message = orderMessage(j);
    if (!willSend) { results.push({ job_id: j.id, name: firstName(j), appliance: appl(j), eta: etaPhrase(j.parts_eta_date) || null, preview: message }); sent++; continue; }
    const res = await guard.guardedSend({ phone: j.customer_phone, message, tag: 'part_ordered_notify', kind: 'status_update' });
    if (res.reason !== 'send_failed') await markNotified(j, res.reason);  // don't retry-spam; only a hard send failure retries
    results.push({ job_id: j.id, sent: res.sent, reason: res.reason });
    if (res.sent) sent++;
  }

  return json({ ok: true, mode: willSend ? 'LIVE' : (dry ? 'dry_preview' : 'shadow'), live_flag: LIVE,
    total_jobs: jobs.length, un_notified_candidates: candidates.length, processed: results.length, sent, results: results.slice(0, 60) });
};
