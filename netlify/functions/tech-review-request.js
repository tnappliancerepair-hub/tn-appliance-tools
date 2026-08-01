// tech-review-request — the tech-initiated review ask. After a job is completed and
// the customer seemed happy, the tech taps one button and we text the customer a warm,
// in-their-language "How'd we do? 👍/👎" message. The reply routes itself: 👍 -> the
// Google review link follows IMMEDIATELY; 👎 -> private "what could we do better?" +
// Teddy alert. The gate keeps an unhappy customer off the public rating.
//
// WHY THIS IS ALLOWED WHEN PROACTIVE CUSTOMER TEXTS ARE OFF: this is NOT automation.
// It's a human tech choosing to text his own just-completed customer — the same open
// human lane as tech-customer-message (857-8800), the one channel intentionally left
// on. Automated/scheduled review asks stay suppressed; this is a person hitting send
// at the moment of the fix, which is also the highest-converting review channel there is.
//
// It logs review_ask_sent (so the review-velocity scorecard counts it) + the
// google_review_asked_customer_<id> dedup row the sweep uses, so the two paths never
// double-ask the same customer within 60 days.
//
//   POST { job_id, tech_id, force? }  ->  { ok, sent, reason, to_masked, lang, review_url }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const reviewI18n = require('./_lib/review-i18n');
const satisfaction = require('./_lib/satisfaction');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const REVIEW_URL = 'https://g.page/r/CRt-vo--eAJ3EBM/review';
const DEDUP_DAYS = 60;
const TECH_NAME = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function last10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
function maskPhone(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? '(' + d.slice(-10, -7) + ') ***-' + d.slice(-4) : ''; }
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

async function askedRecently(custId) {
  if (!custId) return false;
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'google_review_asked_customer_' + custId }, { id: 'desc' });
    if (!row) return false;
    const at = Number(row.created_at || meta(row).at_ms || 0);
    return at > Date.now() - DEDUP_DAYS * 86400000;
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id, 10) || 0;
  const techId = parseInt(b.tech_id, 10) || 0;
  const force = b.force === true || b.force === '1';
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });

  // Resolve the job: customer, appliance, city, tech, language, live-completed.
  let cust = {}, applType = '', cityName = '', techFirst = '', custLang = 'en', liveDone = false;
  try {
    const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    cust = (d && d.customer) || {};
    const ap = (d && d.appliance) || {};
    applType = String((ap && ap.type) || (d && d.job && d.job.appliance_type) || '').trim();
    cityName = String((cust && cust.city) || (d && d.job && d.job.service_city) || '').trim();
    const tk = (d && d.tech) || {};
    techFirst = TECH_NAME[techId] || String((tk && (tk.first_name || tk.name)) || '').trim().split(/\s+/)[0] || '';
    custLang = reviewI18n.langFromPref((d && d.job && d.job.customer_preference_text) || '');
    const jss = String((d && d.job && d.job.scheduling_status) || '').toLowerCase();
    const jcs = String((d && d.job && d.job.current_status) || '').toLowerCase();
    liveDone = (jss === 'completed' || jcs === 'completed' || !!(d && d.job && d.job.job_completed_at));
  } catch (_) {}

  const custId = Number(cust.id || 0);
  const phone10 = last10(cust.phone) || last10(cust.mobile) || last10(cust.phone_number);
  if (!phone10) return json(200, { ok: false, sent: false, reason: 'no_customer_phone', hint: 'No phone on file for this customer yet.' });
  if (!liveDone && !force) return json(200, { ok: false, sent: false, reason: 'not_completed', hint: 'This job isn\'t marked complete yet — finish it first, then send the review ask.' });
  if (!force && await askedRecently(custId)) return json(200, { ok: false, sent: false, reason: 'already_asked', hint: 'This customer was already asked for a review in the last 60 days.' });

  // Send the satisfaction ask ("How'd we do? 👍/👎") in the customer's language.
  // The reply routes itself via _lib/satisfaction (customer-sms-inbound): 👍 -> the
  // Google review link follows IMMEDIATELY; 👎 -> private "what could we do better?"
  // + Teddy alert, so an unhappy customer never lands on the public rating. The tech
  // sends this when the customer seemed happy; the gate is the safety net. (Teddy 2026-08-01)
  const first = String(cust.first_name || 'there').trim().split(/\s+/)[0] || 'there';
  const pack = reviewI18n.pack(custLang);
  const message = pack.ask(first, applType.toLowerCase());

  // Send on the open HUMAN lane (857-8800) — a tech texting his own job's customer.
  const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
  let sent = false, reason = '';
  try {
    const r = await fetch(`${SITE}/.netlify/functions/human-line-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1' + phone10, message, sender: techFirst || 'TN Appliance', job_id: jobId }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    sent = !!(d && d.sent); reason = (d && d.reason) || '';
  } catch (e) { reason = String((e && e.message) || e); }

  if (sent) {
    // Arm the satisfaction gate so the customer's 👍/👎 reply routes itself:
    // 👍 -> Google review link immediately, 👎 -> private feedback + Teddy alert.
    try { await satisfaction.arm('+1' + phone10, { job_id: jobId, cust_id: custId, first, tech: techFirst, appliance: applType, city: cityName, lang: custLang }); } catch (_) {}
    // Fixed-action funnel row (scorecard counts this) + the sweep's dedup row.
    try { await crud.logEvent('review_ask_sent', { cust_id: custId, job_id: jobId, via: 'tech', tech_id: techId, lang: custLang, at_ms: Date.now() }); } catch (_) {}
    try { await crud.logEvent('google_review_asked_customer_' + custId, { job_id: jobId, via: 'tech', tech_id: techId, at_ms: Date.now() }); } catch (_) {}
  }

  return json(200, { ok: sent, sent, reason: sent ? undefined : (reason || 'send_failed'), to_masked: maskPhone(phone10), to_first: first, lang: custLang, review_url: REVIEW_URL });
};
