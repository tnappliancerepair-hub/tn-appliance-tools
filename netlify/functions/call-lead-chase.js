// call-lead-chase — "everybody who calls but doesn't convert gets a follow-up text."
// Phone-call cash leads (like a customer who calls Ant, gives barely any info, and
// never books) slip past book-media-chase (which only catches WEB leads). This
// sweeps recent OPEN self-pay leads and texts them once for the two things we need
// to schedule — their address + availability — plus the AI link to self-serve.
//
// Shares book-media-chase's dedup marker so NOBODY gets double-texted. 9a-7p CT,
// one-per-job, skips scheduled/converted/too-fresh. Kill switch: LEAD_CHASE_ENABLED=off.
//   GET ?dryrun=1   show who'd be texted, send nothing   ·   ?secret= for manual run
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');
const EVENT_LOG = crud.TABLES.event_log;
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const FRESH_MIN = 25;      // wait ~25 min after the call before nudging
const MAX_PER_RUN = 20;    // ramp, don't blast a backlog
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

  const flag = String((await getSecret('LEAD_CHASE_ENABLED')) || '').toLowerCase();
  if (flag === 'off' || flag === 'false') return json(200, { ok: true, skipped: 'LEAD_CHASE_ENABLED=off' });
  if (!dry && (ctHour() < 9 || ctHour() >= 19)) return json(200, { ok: true, skipped: 'outside 9a-7p CT' });

  // 1) recent open cash leads (warranty-dups already filtered by cash-leads)
  let leads = [];
  try { const r = await fetch(`${SITE}/.netlify/functions/cash-leads?days=2`, { signal: AbortSignal.timeout(20000) }); const d = await r.json(); leads = d.leads || []; }
  catch (e) { return json(200, { ok: false, error: 'cash-leads: ' + String(e.message || e) }); }

  // 2) who's already been chased (shared marker across web + call chase) + our own
  const chasedJobs = new Set();
  for (const action of ['book_media_chase_sent', 'call_lead_chase_sent']) {
    try { const rows = await crud.searchPage(EVENT_LOG, { action }, { created_at: 'desc' }, 300); for (const r of rows) { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } if (m.job_id) chasedJobs.add(Number(m.job_id)); } } catch (_) {}
  }

  const sent = [], skipped = [];
  for (const lead of leads) {
    if (sent.length >= MAX_PER_RUN) break;
    const jobId = Number(lead.job_id) || 0;
    const phone = e164(lead.phone);
    if (!jobId || !phone) { skipped.push({ job: jobId, why: 'no job/phone' }); continue; }
    if (INTERNAL.has(phone.replace(/\D/g, '').slice(-10))) { skipped.push({ job: jobId, why: 'internal #' }); continue; }
    if (chasedJobs.has(jobId)) { skipped.push({ job: jobId, why: 'already chased' }); continue; }

    // status + age guard
    let st = '', cst = '', createdMs = 0;
    try { const jd = await fetch(`${XANO}/get_job?job_id=${jobId}`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json()); st = String((jd && jd.scheduling_status) || '').toLowerCase(); cst = String((jd && jd.current_status) || '').toLowerCase(); createdMs = jd && jd.created_at ? new Date(jd.created_at).getTime() : 0; } catch (_) {}
    const TERM = ['scheduled', 'in_progress', 'completed', 'canceled', 'cancelled', 'closed', 'no_fix_possible', 'booked'];
    if (TERM.includes(st) || TERM.includes(cst)) { skipped.push({ job: jobId, why: 'status ' + (st || cst) }); continue; }
    if (createdMs && (Date.now() - createdMs) < FRESH_MIN * 60000) { skipped.push({ job: jobId, why: 'too fresh (<' + FRESH_MIN + 'm)' }); continue; }

    // already gave availability? they're converting — leave them alone
    let hasAvail = false;
    try { const av = await crud.searchPage(EVENT_LOG, { action: 'availability_captured_' + jobId }, { id: 'desc' }, 1); hasAvail = !!(av && av.length); } catch (_) {}
    if (hasAvail) { skipped.push({ job: jobId, why: 'has availability' }); continue; }

    const first = (lead.name || '').trim().split(/\s+/)[0] || 'there';
    const apl = lead.appliance ? (' ' + String(lead.appliance).toLowerCase()) : '';
    const link = `${SITE}/appliance-ai.html?appliance=${slug(lead.appliance)}`;
    const msg = `Hi ${first}, TN Appliance Exchange here — following up on your${apl}. Two quick things so we can get a tech out: (1) your address, and (2) a day or two this week that works — just reply here. Or tap to do it in 60 sec: ${link}  Reply anytime — thanks! 🐜`;

    if (dry) { sent.push({ job: jobId, phone, preview: msg.slice(0, 80) }); continue; }
    const ok = await sendSms(phone, msg, 'customer', 'call_lead_chase');
    try { await crud.logEvent('call_lead_chase_sent', { job_id: jobId, phone: lead.phone || '', appliance: lead.appliance || '', sms: ok, at_ms: Date.now() }); } catch (_) {}
    try { await crud.logEvent('book_media_chase_sent', { job_id: jobId, phone: lead.phone || '', want: 'address+availability', via: 'call_lead_chase', at_ms: Date.now() }); } catch (_) {}
    sent.push({ job: jobId, name: first, sms: ok });
  }

  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', leads_seen: leads.length, texted: sent.length, sent, skipped: skipped.slice(0, 20) });
};
