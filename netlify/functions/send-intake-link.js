// send-intake-link — office-triggered "get this job intook NOW" SMS. From the
// Needs-Scheduling tray on office-calendar.html, when a job has no availability
// yet, Danielle taps "📲 Text intake link" and this texts the customer a guided
// link (opens straight to their job) plus dead-simple 1-2-3 notes:
//   1) short video of the problem  2) photo of the model sticker  3) their days.
// The sooner the intake, the sooner it schedules.
//
// Mirrors the proven intake-collector message/link, but on demand (one job).
// Routes through Xano send_sms so the customer-facing gate + Telnyx creds apply.
// Records availability_requested_<job> so the nightly collector won't re-ask.
//
//   POST { job_id }  ->  { ok, sent, to_last4, reason }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const { sendSms } = require('./_lib/sms');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }
function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'there'; }
async function jget(url, ms = 10000) { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
async function jpost(url, body, ms = 10000) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }

exports.config = { timeout: 24 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }
  const jobId = Number(b.job_id || b.jobId || 0);
  if (!jobId) return json(200, { ok: false, reason: 'missing job_id' });

  // Fast path: the office-calendar board already has the customer phone / first /
  // appliance, so it passes them straight through (no heavy list fetch). Only if
  // they're missing do we fall back to loading the needs-scheduled list.
  let phoneRaw = String(b.phone || '').replace(/\D/g, '');
  let cust = first(b.first);
  let appl = String(b.appliance || '').toLowerCase();

  if (phoneRaw.length < 10) {
    try {
      const d = await jget(`${XANO}/list_needs_scheduled_parallel?limit=1000`, 20000);
      const items = d.items || d.jobs || d.rows || (Array.isArray(d) ? d : []);
      const job = items.find((j) => Number(j.id || j.job_id) === jobId) || null;
      if (job) {
        phoneRaw = String(job.customer_phone || job.phone || job.customer_cell || '').replace(/\D/g, '');
        cust = first(job.customer_first || job.customer_first_name);
        appl = String(job.appliance || job.appliance_type || appl).toLowerCase();
      }
    } catch (_) { return json(200, { ok: false, reason: 'could not load job — try again' }); }
  }

  if (phoneRaw.length < 10) return json(200, { ok: false, reason: 'no phone on file — add one first' });
  const last4 = phoneRaw.slice(-4);
  if (!appl) appl = 'appliance';
  const portal = `${SITE}/customer-portal.html?job_id=${jobId}&last4=${last4}`;
  const msg = `Hi ${cust} — TN Appliance Exchange 🐜. Let's get your ${appl} scheduled fast. It takes about 2 minutes — just 3 easy steps:\n\n` +
    `1) Tap your link: ${portal}\n` +
    `2) Send a short video of the problem + a photo of the model-number sticker\n` +
    `3) Reply here with the days that work for you (and any you can't do)\n\n` +
    `That's all we need to lock in your visit. Thank you!`;

  const sent = await sendSms(phoneRaw, msg, 'customer', 'office_intake_link');
  if (!sent) return json(200, { ok: false, reason: 'texting is gated/failed — check the customer SMS gate' });

  // Mark it so the nightly intake-collector treats this as an already-sent ask.
  try {
    await jpost(`${XANO}/record_event_log`, {
      action: `availability_requested_${jobId}`,
      metadata_json: JSON.stringify({ job_id: jobId, source: 'office_calendar_button', at_ms: Date.now() }),
    }, 8000);
  } catch (_) {}

  return json(200, { ok: true, sent: true, to_last4: last4, job_id: jobId });
};
