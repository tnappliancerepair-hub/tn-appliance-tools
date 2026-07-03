// sms-thread — the WHOLE customer SMS conversation for a job, keyed by PHONE.
//
// Why this exists (Jimmy 2026-07-04: "the text thread only shows the last piece"):
// the old get_sms_thread_for_job matches by job_id, but SMS event_log rows are
// phone-keyed — OUTBOUND `sms_sent` rows carry NO job_id, and INBOUND rows are
// often logged with job_id=0. So a job_id match returns a sparse fragment. This
// resolves the job's customer phone, then gathers EVERY inbound + outbound + reply
// row to/from that phone (normalized to last-10 digits) and returns them in
// chronological order — the full back-and-forth. Netlify (auto-deploys; no Mac push).
//
//   GET ?job_id=123[&phone=+1...][&hours_back=720]  -> { ok, phone, messages:[{action,metadata,ts_ms}] }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const EVENT_LOG = crud.TABLES.event_log; // 3
const JOBS = crud.TABLES.jobs;           // 7
const CUSTOMER = crud.TABLES.customer;   // 6

// Every action that represents a text in the customer conversation.
// Big-volume ones get a deeper page; the rest are rarer.
const ACTIONS = [
  ['inbound_customer_sms_received', 600],
  ['sms_sent', 600],
  ['sms_owner_bypass', 200],
  ['customer_sms_reply', 400],
  ['feedback_sms_sent', 200],
  ['teddy_sms_triggered', 120],
  ['sms_gated', 200],
  ['dropped_customer_sms', 200],
];

function last10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }
function json(code, body) { return { statusCode: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) }; }

// The customer-phone-bearing fields on a row's metadata (NOT from_number/our number).
function rowCustomerPhone10(md) {
  return last10(md.phone) || last10(md.recipient) || last10(md.to) || '';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const jobId = parseInt(q.job_id, 10) || 0;
  const hoursBack = Math.max(1, Math.min(4320, parseInt(q.hours_back, 10) || 720)); // default 30d, cap 180d
  const sinceMs = Date.now() - hoursBack * 3600 * 1000;

  // 1) Resolve the customer's phone + id for this job (client may also pass ?phone=).
  let phone10 = last10(q.phone);
  let customerId = 0;
  if (jobId) {
    try {
      const job = await crud.searchOne(JOBS, { id: jobId });
      if (job) {
        customerId = Number(job.customer_id) || 0;
        phone10 = phone10 || last10(job.customer_phone) || last10(job.phone) || last10(job.bill_to_phone);
        if (!phone10 && customerId) {
          const cust = await crud.searchOne(CUSTOMER, { id: customerId });
          if (cust) phone10 = last10(cust.phone) || last10(cust.mobile) || last10(cust.phone_number);
        }
      }
    } catch (_) {}
  }
  // Last-ditch: derive the phone from any inbound row tagged with this job_id.
  if (!phone10 && jobId) {
    try {
      const rows = await crud.searchPage(EVENT_LOG, { action: 'inbound_customer_sms_received' }, { created_at: 'desc' }, 400);
      for (const r of rows) { const md = asObj(r.metadata); if (Number(md.job_id) === jobId) { phone10 = rowCustomerPhone10(md); if (phone10) break; } }
    } catch (_) {}
  }

  if (!phone10 && !jobId && !customerId) return json(200, { ok: false, error: 'need job_id or phone', messages: [] });

  // 2) Gather every SMS row across the actions, filter to THIS conversation.
  const pages = await Promise.all(ACTIONS.map(([action, per]) =>
    crud.searchPage(EVENT_LOG, { action }, { created_at: 'desc' }, per).catch(() => [])
  ));

  const seen = new Set();
  const out = [];
  pages.forEach((rows, i) => {
    const action = ACTIONS[i][0];
    for (const r of rows) {
      const ts = Number(r.created_at) || 0;
      if (ts && ts < sinceMs) continue;
      const md = asObj(r.metadata);
      // Match this row to the conversation: customer phone (last-10) OR job/customer id.
      const match = (phone10 && rowCustomerPhone10(md) === phone10)
        || (jobId && Number(md.job_id) === jobId)
        || (customerId && Number(md.customer_id) === customerId);
      if (!match) continue;
      // Dedupe on the provider id when present, else action+ts+text.
      const key = md.provider_message_id || md.provider_sid || (action + '|' + ts + '|' + String(md.body_preview || '').slice(0, 40));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ action, metadata: md, ts_ms: ts });
    }
  });

  // 3) Chronological (oldest → newest) so the thread reads top-to-bottom.
  out.sort((a, b) => a.ts_ms - b.ts_ms);

  return json(200, { ok: true, job_id: jobId, phone: phone10, count: out.length, messages: out });
};
