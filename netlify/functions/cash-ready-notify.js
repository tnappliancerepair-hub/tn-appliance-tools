// cash-ready-notify — the speed-to-schedule push for cash jobs. The moment a
// self-pay web lead has given their availability (so it CAN be scheduled), alert
// the people who book it — Danielle (the scheduler) AND Teddy. For cash work,
// whoever schedules first wins the job, so this kills the lag of waiting for
// someone to open the board.
//
// Two layers so a cash lead can NEVER sit (the Jaswinder-sat-all-weekend fix):
//   1) FIRST TOUCH — text Danielle + Teddy once the lead has availability (dedup
//      cash_ready_notified, once per job).
//   2) ESCALATION — if the lead is STILL open (unscheduled) 3+ hrs later, re-alert
//      once per day (dedup cash_ready_escalated by job+CT-date) until it's booked.
//
// Reuses cash-leads for the lead list (one source of truth). Self-gates 8a-8p CT.
//   GET ?dryrun=1   inspect without texting
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const EVENT_LOG = 3;
const OWNER = '+16154855795';
const SITE = 'https://tnapplianceexchange.net';
const ESC_MS = 3 * 60 * 60 * 1000;   // re-alert after a lead has sat unscheduled 3+ hrs
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctHour() { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date())); } catch (_) { return 12; } }
function ctDate() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()); } catch (_) { return String(new Date().toISOString().slice(0, 10)); } }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function fmtPhone(p) { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : ''; }

async function alertBoth(msg, tag, dry) {
  if (dry) return;
  const danielle = (await getSecret('OFFICE_CELL_DANIELLE')) || '+16154850713';
  // Danielle first — she's the one who schedules; Teddy for visibility. Internal
  // roles bypass the customer intake gate (this never goes to the customer).
  for (const [cell, role] of [[danielle, 'office'], [OWNER, 'owner']]) {
    try { await sendSms(cell, msg, role, tag); } catch (_) {}
  }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  if (String(await getSecret('CASH_READY_NOTIFY') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const hour = ctHour();
  if (!dry && (hour < 8 || hour >= 20)) return json(200, { ok: true, skipped: 'outside 8a-8p CT' });
  const today = ctDate();

  // Lead list from cash-leads (open self-pay only, has availability). A lead STILL
  // in this list on a later run = still unscheduled (it drops off once booked).
  let leads = [];
  try {
    const base = process.env.URL || SITE;
    const d = await fetch(`${base}/.netlify/functions/cash-leads?days=14`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    leads = ((d && d.leads) || []).filter((L) => String(L.availability || '').trim());
  } catch (e) { return json(200, { ok: false, error: 'cash-leads fetch failed: ' + String(e.message || e) }); }

  // first-notified time per job + who's been escalated today
  let notified = [], escalated = [];
  try { notified = await crud.searchPage(EVENT_LOG, { action: 'cash_ready_notified' }, { created_at: 'desc' }, 400); } catch (_) {}
  try { escalated = await crud.searchPage(EVENT_LOG, { action: 'cash_ready_escalated' }, { created_at: 'desc' }, 400); } catch (_) {}
  const notifiedAt = new Map();       // job_id -> earliest notify at_ms
  for (const r of notified) { const m = meta(r); const j = Number(m.job_id); if (!j) continue; const t = Number(m.at_ms) || 0; if (!notifiedAt.has(j) || t < notifiedAt.get(j)) notifiedAt.set(j, t); }
  const escToday = new Set(escalated.filter((r) => meta(r).date === today).map((r) => Number(meta(r).job_id)).filter(Boolean));

  const sent = [], escalatedNow = [], skipped = [];
  const now = Date.now();
  for (const L of leads) {
    const jobId = Number(L.job_id) || 0; if (!jobId) continue;
    const appl = (L.appliance || 'appliance').toLowerCase();
    const phoneFmt = fmtPhone(L.phone);
    const call = phoneFmt ? ('Call ' + phoneFmt + '. ') : '';

    // --- FIRST TOUCH ---
    if (!notifiedAt.has(jobId)) {
      const msg = `💵 NEW cash lead ready to schedule: ${L.name} — ${appl}. Available: ${L.availability}. ${call}Book it: ${SITE}/cash-leads.html`;
      if (dry) { sent.push({ job: jobId, name: L.name, preview: msg.slice(0, 110) }); continue; }
      try { await crud.logEvent('cash_ready_notified', { job_id: jobId, name: L.name, availability: L.availability, at_ms: now }); } catch (_) {}
      notifiedAt.set(jobId, now);
      await alertBoth(msg, 'cash_ready_notify', dry);
      sent.push({ job: jobId, name: L.name });
      continue;
    }

    // --- ESCALATION --- still open, sat 3+ hrs, not yet nudged today
    const firstAt = notifiedAt.get(jobId) || 0;
    if (!escToday.has(jobId) && firstAt && (now - firstAt) >= ESC_MS) {
      const hrs = Math.round((now - firstAt) / 3600000);
      const msg = `⏰ STILL UNSCHEDULED cash lead (${hrs}h): ${L.name} — ${appl}. Available: ${L.availability}. ${call}Whoever books first wins the job. ${SITE}/cash-leads.html`;
      if (dry) { escalatedNow.push({ job: jobId, name: L.name, hrs, preview: msg.slice(0, 110) }); continue; }
      try { await crud.logEvent('cash_ready_escalated', { job_id: jobId, name: L.name, date: today, hours_open: hrs, at_ms: now }); } catch (_) {}
      escToday.add(jobId);
      await alertBoth(msg, 'cash_ready_escalate', dry);
      escalatedNow.push({ job: jobId, name: L.name, hrs });
      continue;
    }
    skipped.push({ job: jobId, why: escToday.has(jobId) ? 'escalated today' : 'notified, <3h' });
  }
  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', ct_hour: hour, leads_with_avail: leads.length, first_touch: sent.length, escalations: escalatedNow.length, skipped: skipped.length, first_list: sent.slice(0, 10), escalated_list: escalatedNow.slice(0, 10) });
};
