// cash-ready-notify — the speed-to-schedule push for cash jobs. The moment a
// self-pay web lead has given their availability (so it CAN be scheduled), text
// Teddy once: "💵 ready to book" + a tap to the cash-leads board. For cash work,
// whoever schedules first wins the job — this kills the lag of waiting for
// someone to open the board.
//
// Reuses the cash-leads function for the lead list (one source of truth). Texts
// ONCE per job (cash_ready_notified dedup). Self-gates to 8a-8p CT. Hourly.
//   GET ?dryrun=1   inspect without texting
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG = 3;
const OWNER = '+16154855795';
const SITE = 'https://tnapplianceexchange.net';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctHour() { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date())); } catch (_) { return 12; } }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  if (String(await getSecret('CASH_READY_NOTIFY') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const hour = ctHour();
  if (!dry && (hour < 8 || hour >= 20)) return json(200, { ok: true, skipped: 'outside 8a-8p CT' });

  // Lead list from the cash-leads function (open self-pay only, has availability).
  let leads = [];
  try {
    const base = process.env.URL || SITE;
    const d = await fetch(`${base}/.netlify/functions/cash-leads?days=14`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    leads = ((d && d.leads) || []).filter((L) => String(L.availability || '').trim());
  } catch (e) { return json(200, { ok: false, error: 'cash-leads fetch failed: ' + String(e.message || e) }); }

  // Already-notified set.
  let notified = [];
  try { notified = await crud.searchPage(EVENT_LOG, { action: 'cash_ready_notified' }, { created_at: 'desc' }, 300); } catch (_) {}
  const notifiedJobs = new Set(notified.map((r) => Number(meta(r).job_id)).filter(Boolean));

  const sent = [], skipped = [];
  for (const L of leads) {
    const jobId = Number(L.job_id) || 0; if (!jobId) continue;
    if (notifiedJobs.has(jobId)) { skipped.push({ job: jobId, why: 'already notified' }); continue; }
    const appl = (L.appliance || 'appliance').toLowerCase();
    const phone = String(L.phone || '').replace(/\D/g, '').slice(-10);
    const phoneFmt = phone.length === 10 ? phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : '';
    const msg = `💵 Cash lead ready to schedule: ${L.name} — ${appl}. Available: ${L.availability}. ${phoneFmt ? ('Call ' + phoneFmt + '. ') : ''}Book it: ${SITE}/cash-leads.html`;

    if (dry) { sent.push({ job: jobId, name: L.name, preview: msg.slice(0, 110) }); continue; }
    // claim before send so a double-run can't double-text
    try { await crud.logEvent('cash_ready_notified', { job_id: jobId, name: L.name, availability: L.availability, at_ms: Date.now() }); } catch (_) {}
    notifiedJobs.add(jobId);
    // OWNER-ONLY internal notification (never goes to the customer).
    try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: msg, force_send: true, context_tag: 'cash_ready_notify' }), signal: AbortSignal.timeout(12000) }); } catch (_) {}
    sent.push({ job: jobId, name: L.name });
  }
  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', ct_hour: hour, leads_with_avail: leads.length, sent: sent.length, skipped: skipped.length, sent_list: sent.slice(0, 10), skipped_list: skipped.slice(0, 8) });
};
