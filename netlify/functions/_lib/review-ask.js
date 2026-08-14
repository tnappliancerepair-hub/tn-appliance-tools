// review-ask — the ONE place that sends the gated "How'd we do? 👍/👎" review ask
// for a single job. Shared by:
//   • job-completion-watch  → fires the instant a job flips to completed (near-real-time)
//   • review-request-sweep  → nightly backstop for anything the instant path missed
//
// THE FLOW Teddy wants (2026-08-14): the moment a job is completed, the customer gets
// "How'd we do? 👍 / 👎". A 👍 reply then triggers the thank-you + Google review link;
// a 👎 triggers the private "what could we do better?" capture + owner alert. The 👍/👎
// handling already lives in _lib/satisfaction (handleInbound); this module sends the
// GATED first ask (rp.ask — NOT the direct-link askDirect) and arms that gate.
//
// SAFE BY CONSTRUCTION: only sends when the job's LIVE status is completed, only once
// per customer per 60 days (shared dedup key), and only if the customer has a phone.
// The dedup row is written ONLY after sendSms actually reports sent — so a quiet-hours
// or opt-out drop leaves the backstop free to retry later (never a silent "asked but
// never delivered").
'use strict';
const crud = require('./xano/metadata-crud');
const { sendSms } = require('./sms');
const satisfaction = require('./satisfaction');
const reviewI18n = require('./review-i18n');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const DEDUP_DAYS = 60;

function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; if (String(p || '').startsWith('+')) return String(p); return null; }

// Has this customer already been asked (via ANY path) inside the dedup window?
async function askedRecently(custId) {
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'google_review_asked_customer_' + custId }, { id: 'desc' });
    if (!row) return false;
    const at = Number(row.created_at || meta(row).at_ms || 0);
    return at > Date.now() - DEDUP_DAYS * 86400000;
  } catch (_) { return false; }
}

// Send the gated review ask for one job.
//   opts.via     'completion_instant' | 'sweep' | ...  (recorded for the scorecard)
//   opts.source  candidate source tag (completed|invoice|...)
//   opts.dry     true = evaluate gates + return {would_send}, send nothing
//   opts.force   true = skip the live-completed recheck (manual override only)
// Returns { sent } / { would_send } / { sent:false, reason }.
async function sendAskForJob(jobId, opts) {
  opts = opts || {};
  const via = opts.via || 'sweep';
  const source = opts.source || via;

  let cust = {}, applType = '', techName = '', cityName = '', liveDone = false, custLang = 'en';
  try {
    const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    cust = (d && d.customer) || {};
    const ap = (d && d.appliance) || {};
    applType = String((ap && ap.type) || (d && d.job && d.job.appliance_type) || '').trim();
    const tk = (d && d.tech) || {};
    techName = String((tk && (tk.first_name || tk.name)) || '').trim().split(/\s+/)[0] || '';
    cityName = String((cust && cust.city) || (d && d.job && d.job.service_city) || '').trim();
    // Re-check LIVE status — the completion signal can be stale (reopened / mis-tapped).
    // Only ask "how'd we do?" if the job is ACTUALLY completed right now.
    const jss = String((d && d.job && d.job.scheduling_status) || '').toLowerCase();
    const jcs = String((d && d.job && d.job.current_status) || '').toLowerCase();
    liveDone = (jss === 'completed' || jcs === 'completed');
    custLang = reviewI18n.langFromPref((d && d.job && d.job.customer_preference_text) || '');
  } catch (_) { return { sent: false, reason: 'lookup_failed' }; }

  const custId = Number(cust.id || 0);
  const phone = e164(cust.phone);
  if (!custId || !phone) return { sent: false, reason: 'no_customer_or_phone', cust_id: custId };
  if (!opts.force && !liveDone) return { sent: false, reason: 'not_currently_completed', cust_id: custId };
  if (await askedRecently(custId)) return { sent: false, reason: 'asked_within_60d', cust_id: custId };

  const first = cust.first_name || 'there';
  const appl = applType.toLowerCase();
  const rp = reviewI18n.pack(custLang);
  // ALWAYS the gated ask ("How'd we do? 👍/👎") — never askDirect. 👍 → thank-you + link.
  const body = rp.ask(first, appl);

  if (opts.dry) return { sent: false, would_send: true, cust_id: custId, first, lang: custLang };

  let okSent = false;
  try { okSent = await sendSms(phone, body, 'customer', 'satisfaction_check'); } catch (_) { okSent = false; }
  if (!okSent) return { sent: false, reason: 'send_blocked_or_failed', cust_id: custId };

  // Arm the 👍/👎 gate so the reply routes itself (satisfaction.handleInbound).
  try { await satisfaction.arm(phone, { job_id: jobId, cust_id: custId, first, tech: techName, appliance: applType, city: cityName, lang: custLang }); } catch (_) {}
  // Dedup marker (shared 60-day key) + fixed-action funnel row for the scorecard —
  // written ONLY after a real send, so a blocked send leaves the backstop free to retry.
  try { await crud.logEvent('google_review_asked_customer_' + custId, { job_id: jobId, via, source, at_ms: Date.now() }); } catch (_) {}
  try { await crud.logEvent('review_ask_sent', { cust_id: custId, job_id: jobId, via, source, lang: custLang, at_ms: Date.now() }); } catch (_) {}
  return { sent: true, cust_id: custId, first, lang: custLang };
}

module.exports = { sendAskForJob, askedRecently };
