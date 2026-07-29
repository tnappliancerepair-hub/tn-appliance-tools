// review-request-sweep — after a job completes, texts the customer "How'd we do? 👍/👎"
// and arms the satisfaction gate. Their reply routes itself (customer-sms-inbound ->
// _lib/satisfaction): 👍 -> Google review link, 👎 -> "what could we have done better?"
// (private capture + Teddy alert, so an unhappy customer is handled by a human instead
// of leaving a public 1-star). Reviews lift Local Services Ads rank + the map pack.
//
// Forward-only (only completions in the lookback window — historical never fires) + 60-day
// per-customer dedup, sharing the SAME dedup key as the colony agent so we never double-text.
//
//   scheduled (daily)   ask recently-completed customers
//   GET ?dryrun=1       show who WOULD be asked, send nothing
//   GET ?hours=N        lookback window (default 26h)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const satisfaction = require('./_lib/satisfaction');
const reviewI18n = require('./_lib/review-i18n');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const REVIEW_URL = 'https://g.page/r/CRt-vo--eAJ3EBM/review';
const DEDUP_DAYS = 60;
const MAX_PER_RUN = 25;

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; if (String(p || '').startsWith('+')) return String(p); return null; }

async function askedRecently(custId) {
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'google_review_asked_customer_' + custId }, { id: 'desc' });
    if (!row) return false;
    const at = Number(row.created_at || meta(row).at_ms || 0);
    return at > Date.now() - DEDUP_DAYS * 86400000;
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  const hours = Math.min(parseInt(q.hours || '26', 10) || 26, 168);
  const since = Date.now() - hours * 3600000;

  // 1) recent completions (job actually done — new_scheduling_status === 'completed')
  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'tech_job_complete' }, { id: 'desc' }, 120); } catch (e) { return j(200, { ok: false, error: 'event scan failed' }); }
  const jobIds = [];
  const seen = new Set();
  for (const r of rows) {
    const at = Number(r.created_at || 0);
    if (at && at < since) continue;                 // forward-only: skip old completions
    const m = meta(r);
    if (String(m.new_scheduling_status || '') !== 'completed') continue;  // only truly-done jobs
    const jid = Number(m.job_id || 0);
    if (jid && !seen.has(jid)) { seen.add(jid); jobIds.push(jid); }
  }

  // 2) resolve each job's customer, dedup, send
  const sent = [], skipped = [];
  for (const jid of jobIds.slice(0, MAX_PER_RUN)) {
    let cust = {}, applType = '', techName = '', cityName = '', liveDone = false, custLang = 'en';
    try {
      const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jid }), signal: AbortSignal.timeout(10000) }).then((r) => r.json());
      cust = (d && d.customer) || {};
      // d.appliance is an OBJECT { type, brand, ... } — pull the type string
      // (String(object) was rendering "[object Object]" in the customer text).
      const ap = (d && d.appliance) || {};
      applType = String((ap && ap.type) || (d && d.job && d.job.appliance_type) || '').trim();
      // tech first name + service city — used to personalize the review ask
      const tk = (d && d.tech) || {};
      techName = String((tk && (tk.first_name || tk.name)) || '').trim().split(/\s+/)[0] || '';
      cityName = String((cust && cust.city) || (d && d.job && d.job.service_city) || '').trim();
      // Re-check the job's LIVE status — the completion event may be stale
      // (job later rescheduled/reopened, or a mis-tapped completion). Only ask
      // "how'd we do?" if the job is ACTUALLY completed right now, so a merely
      // scheduled customer never gets a post-service text. (Teddy 2026-07-04)
      const jss = String((d && d.job && d.job.scheduling_status) || '').toLowerCase();
      const jcs = String((d && d.job && d.job.current_status) || '').toLowerCase();
      liveDone = (jss === 'completed' || jcs === 'completed');
      // customer's language is flagged into customer_preference_text at intake
      custLang = reviewI18n.langFromPref((d && d.job && d.job.customer_preference_text) || '');
    } catch (_) {}
    const custId = Number(cust.id || 0);
    const phone = e164(cust.phone);
    if (!custId || !phone) { skipped.push({ job_id: jid, why: 'no customer/phone' }); continue; }
    if (!liveDone) { skipped.push({ job_id: jid, customer: custId, why: 'not currently completed (scheduled/reopened) — no satisfaction text' }); continue; }
    if (await askedRecently(custId)) { skipped.push({ job_id: jid, customer: custId, why: 'asked < 60d' }); continue; }
    const first = cust.first_name || 'there';
    const appl = applType.toLowerCase();
    const body = reviewI18n.pack(custLang).ask(first, appl);
    if (dry) { sent.push({ job_id: jid, customer: custId, phone, first, lang: custLang }); continue; }
    let ok = false;
    try { await sendSms(phone, body, 'customer', 'satisfaction_check'); ok = true; } catch (_) {}
    if (ok) {
      try { await satisfaction.arm(phone, { job_id: jid, cust_id: custId, first, tech: techName, appliance: applType, city: cityName, lang: custLang }); } catch (_) {}
      try { await crud.logEvent('google_review_asked_customer_' + custId, { job_id: jid, via: 'sweep', at_ms: Date.now() }); } catch (_) {}
      sent.push({ job_id: jid, customer: custId, first });
    } else skipped.push({ job_id: jid, why: 'send failed (gate?)' });
  }

  return j(200, { ok: true, mode: dry ? 'dryrun' : 'live', lookback_hours: hours, completions_found: jobIds.length, asked: sent.length, skipped: skipped.length, sent, skipped: skipped.slice(0, 10) });
};
