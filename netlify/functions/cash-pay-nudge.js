// cash-pay-nudge — "we don't schedule until you pay." When a CASH customer goes
// through the site and is sitting there expecting to get scheduled but hasn't
// paid, this nudges them back with the fastest path onto the schedule: the $50
// Quick Check (photo + video → quote within hours).
//
// CASH ONLY — warranty customers are NEVER nudged for payment (cash-leads already
// drops any self_pay job whose customer also has a warranty job, and we re-confirm
// each is truly unpaid via cash-payment-status before sending). This is the same
// safety that keeps a warranty customer from ever seeing a payment ask.
//
// 9a-7p CT, deduped (one nudge / job / 4 days), skips paid/scheduled/too-fresh.
// Kill switch: CASH_PAY_NUDGE_ENABLED=off.   ?dryrun=1 to preview · ?secret= manual.
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');
const EVENT_LOG = crud.TABLES.event_log;
const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const FRESH_MIN = 60;        // give them an hour after intake to pay before nudging
const RENUDGE_DAYS = 4;      // at most one nudge per job per 4 days
const MAX_PER_RUN = 20;
const INTERNAL = new Set(['6154855795', '6154850713', '6152802949', '6155889500', '6158578800', '8662680111']);
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctHour() { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(new Date()), 10); }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return d ? (p.startsWith('+') ? p : '+' + d) : ''; }
const slug = (a) => String(a || '').toLowerCase().replace(/[^a-z]/g, '') || 'appliance';

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const dry = q.dryrun === '1';
  if (q.secret != null && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const flag = String((await getSecret('CASH_PAY_NUDGE_ENABLED')) || '').toLowerCase();
  if (flag === 'off' || flag === 'false') return json(200, { ok: true, skipped: 'CASH_PAY_NUDGE_ENABLED=off' });
  if (!dry && (ctHour() < 9 || ctHour() >= 19)) return json(200, { ok: true, skipped: 'outside 9a-7p CT' });

  // 1) recent cash leads (cash-leads has ALREADY dropped warranty-dups — the
  //    warranty-never-charged safety). We only want the UNPAID ones.
  let leads = [];
  try { const r = await fetch(`${SITE}/.netlify/functions/cash-leads?days=14`, { signal: AbortSignal.timeout(20000) }); const d = await r.json(); leads = d.leads || []; }
  catch (e) { return json(200, { ok: false, error: 'cash-leads: ' + String(e.message || e) }); }
  const unpaidLeads = leads.filter((l) => !l.paid && l.phone);

  // 2) dedup — skip anyone nudged for pay in the last RENUDGE_DAYS
  const cutoff = Date.now() - RENUDGE_DAYS * 86400000;
  const recentlyNudged = new Set();        // by job_id
  const recentlyNudgedPhones = new Set();  // by phone last-10 — one nudge per PERSON
  try {
    const rows = await crud.searchPage(EVENT_LOG, { action: 'cash_pay_nudge_sent' }, { created_at: 'desc' }, 400);
    for (const r of rows) { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } const t = r.created_at ? new Date(r.created_at).getTime() : 0; if (t < cutoff) continue; if (m.job_id) recentlyNudged.add(Number(m.job_id)); const ph = String(m.phone || '').replace(/\D/g, '').slice(-10); if (ph) recentlyNudgedPhones.add(ph); }
  } catch (_) {}

  // 3) authoritative paid re-check on the candidate ids (payment_status +
  //    quick_check_paid events) so we NEVER nudge someone who actually paid, and
  //    a final cash-only type guard.
  const candIds = unpaidLeads.map((l) => Number(l.job_id)).filter(Boolean);
  let paidMap = {}, typeMap = {};
  if (candIds.length) {
    try { const r = await fetch(`${SITE}/.netlify/functions/cash-payment-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: candIds }), signal: AbortSignal.timeout(20000) }); const d = await r.json(); paidMap = d.paid || {}; typeMap = d.types || {}; } catch (_) {}
  }

  const sent = [], skipped = [], sentPhones = new Set();
  for (const lead of unpaidLeads) {
    if (sent.length >= MAX_PER_RUN) break;
    const jobId = Number(lead.job_id) || 0;
    const phone = e164(lead.phone);
    if (!jobId || !phone) { skipped.push({ job: jobId, why: 'no job/phone' }); continue; }
    const ph10 = phone.replace(/\D/g, '').slice(-10);
    if (INTERNAL.has(ph10)) { skipped.push({ job: jobId, why: 'internal #' }); continue; }
    if (recentlyNudged.has(jobId)) { skipped.push({ job: jobId, why: 'nudged recently' }); continue; }
    // one nudge per PERSON — don't text someone 3 times because they have 3 jobs
    if (sentPhones.has(ph10) || recentlyNudgedPhones.has(ph10)) { skipped.push({ job: jobId, why: 'person already nudged' }); continue; }
    if (paidMap[jobId] === true) { skipped.push({ job: jobId, why: 'actually paid' }); continue; }
    // hard cash-only guard: if the authoritative type came back warranty, never nudge
    const t = String(typeMap[jobId] || '').toLowerCase();
    if (t && !(t === 'self_pay' || t === 'cash' || t === 'customer_pay')) { skipped.push({ job: jobId, why: 'not cash (' + t + ')' }); continue; }

    // status + age guard — skip already-scheduled/terminal + too-fresh
    let st = '', cst = '', createdMs = 0;
    try { const jd = await fetch(`${XANO}/get_job?job_id=${jobId}`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json()); st = String((jd && jd.scheduling_status) || '').toLowerCase(); cst = String((jd && jd.current_status) || '').toLowerCase(); createdMs = jd && jd.created_at ? new Date(jd.created_at).getTime() : 0; } catch (_) {}
    const TERM = ['scheduled', 'in_progress', 'completed', 'canceled', 'cancelled', 'closed', 'no_fix_possible', 'booked'];
    if (TERM.includes(st) || TERM.includes(cst)) { skipped.push({ job: jobId, why: 'status ' + (st || cst) }); continue; }
    if (createdMs && (Date.now() - createdMs) < FRESH_MIN * 60000) { skipped.push({ job: jobId, why: 'too fresh' }); continue; }

    const first = (lead.name || '').trim().split(/\s+/)[0] || 'there';
    const apl = lead.appliance ? (' ' + String(lead.appliance).toLowerCase()) : ' repair';
    const link = `${SITE}/appliance-ai.html?appliance=${slug(lead.appliance)}`;
    const msg = `Hi ${first}, TN Appliance Exchange here about your${apl}. Quick heads-up — we don't schedule the repair until payment's made. The fastest way onto our schedule is the $50 Quick Check: just snap a photo of the model sticker + a short video of the problem, and we'll get you a quote within hours (the $50 goes toward your repair). Tap here: ${link}  Reply with any questions! 🐜`;

    if (dry) { sentPhones.add(ph10); sent.push({ job: jobId, name: first, phone, preview: msg.slice(0, 90) }); continue; }
    sentPhones.add(ph10);
    const ok = await sendSms(phone, msg, 'customer', 'cash_pay_nudge');
    try { await crud.logEvent('cash_pay_nudge_sent', { job_id: jobId, phone: lead.phone || '', appliance: lead.appliance || '', sms: ok, at_ms: Date.now() }); } catch (_) {}
    sent.push({ job: jobId, name: first, sms: ok });
  }

  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', unpaid_leads: unpaidLeads.length, texted: sent.length, sent, skipped: skipped.slice(0, 25) });
};
