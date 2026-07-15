// portal-message — the customer types into THEIR portal thread and it joins the ONE
// unified per-job conversation (Teddy 2026-07-15: "one text thread between the office
// dashboard, the office tiles, the job tiles, and the customer's portal — all three
// see + participate"). A portal message is recorded as an INBOUND customer message
// (source:'portal'), so it renders as a Customer bubble on every surface (office tile,
// tech page, portal) and a HUMAN answers it on the human line (757-5500). No AI is
// triggered and no outbound SMS goes to the customer — they're already reading the
// thread in their portal.
//
//   POST { job_id, last4?, message }  ->  { ok, recorded }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');

const JOBS = crud.TABLES.jobs;         // 7
const CUSTOMER = crud.TABLES.customer; // 6
const DANIELLE = process.env.DANIELLE_PHONE_NUMBER || '+16154850713';

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function last10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }

// Resolve the job's customer phone (last-10) + first name — same chain sms-thread /
// tech-customer-message use: job denorm -> customer record -> job-truth fallback.
async function resolveCustomer(jobId) {
  let phone10 = '', first = '';
  try {
    const job = await crud.searchOne(JOBS, { id: jobId });
    if (job) {
      phone10 = last10(job.customer_phone) || last10(job.phone) || last10(job.bill_to_phone);
      first = String(job.customer_first || '').trim();
      const cid = Number(job.customer_id) || 0;
      if ((!phone10 || !first) && cid) {
        const cust = await crud.searchOne(CUSTOMER, { id: cid });
        if (cust) {
          phone10 = phone10 || last10(cust.phone) || last10(cust.mobile) || last10(cust.phone_number);
          first = first || String(cust.first_name || cust.name || '').trim().split(/\s+/)[0] || '';
        }
      }
    }
  } catch (_) {}
  if (!phone10) {
    try {
      const site = process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net';
      const tr = await fetch(`${site}/.netlify/functions/job-truth?job_id=${jobId}&lens=office`, { signal: AbortSignal.timeout(7000) }).then((r) => r.json());
      phone10 = last10((tr && tr.facts && tr.facts.customer_phone) || '');
      first = first || String((tr && tr.facts && tr.facts.customer_first) || '').trim();
    } catch (_) {}
  }
  return { phone10, first, real4: phone10 ? phone10.slice(-4) : '' };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id, 10) || 0;
  const message = String(b.message || '').trim();
  const last4 = String(b.last4 || b.phone_last4 || '').replace(/\D/g, '').slice(-4);
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });
  if (!message) return json(400, { ok: false, error: 'message required' });
  if (message.length > 900) return json(400, { ok: false, error: 'message too long' });

  const { phone10, first, real4 } = await resolveCustomer(jobId);
  if (!phone10) return json(200, { ok: false, error: 'no_customer_phone' });
  // Soft auth: the portal is already last-4 gated; re-check when a last4 is passed.
  if (last4 && real4 && last4 !== real4) return json(403, { ok: false, error: 'last4_mismatch' });

  // Record as an INBOUND customer message so it lands in the unified thread on EVERY
  // surface (sms-thread reads inbound_customer_sms_received). source:'portal' marks the
  // channel; it stays a customer-inbound row (a human on our side answers on 757-5500).
  try {
    await crud.logEvent('inbound_customer_sms_received', {
      job_id: jobId, customer_id: 0, phone: '+1' + phone10, from: '+1' + phone10,
      body: message, message, source: 'portal', channel: 'portal', at_ms: Date.now(),
    });
  } catch (e) {
    return json(200, { ok: false, error: 'record_failed', detail: String((e && e.message) || e) });
  }

  // Best-effort INTERNAL heads-up so a human actually answers (staff alert, NOT a
  // customer text — bypasses the customer gate). Never blocks the ack.
  try {
    const who = first || 'A customer';
    await sendSms(DANIELLE, `💬 ${who} (job #${jobId}) messaged from their portal: "${message.slice(0, 140)}" — reply in Messages.`, 'danielle', 'portal_customer_message');
  } catch (_) {}

  return json(200, { ok: true, recorded: true });
};
