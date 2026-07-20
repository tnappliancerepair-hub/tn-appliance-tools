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

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JOBS = crud.TABLES.jobs;           // 7 (fast: primary-key lookups)
const CUSTOMER = crud.TABLES.customer;   // 6

// Fast event pull via the Xano FUNCTION API (indexed) — the Metadata content
// search on the giant event_log table is far too slow (26s timeout).
async function listEvents(action, daysBack, limit) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${encodeURIComponent(action)}&days_back=${daysBack}&limit=${limit}`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    return (d && (d.items || d.rows)) || [];
  } catch (_) { return []; }
}

// Every action that represents a text in the customer conversation.
// Big-volume ones get a deeper page; the rest are rarer.
// Per-action fetch depth. sms_sent is VERY high-volume (~1,300/day) so a small limit
// buries a given customer's older messages under everyone else's — which made a tech-
// tile thread look one-sided (only the inbound rows, which are far fewer, survived).
// (Teddy 2026-07-07 — Jen Ross.) Pull deep enough to reach ~2 days of the busy actions.
const ACTIONS = [
  ['inbound_customer_sms_received', 1500],
  ['sms_sent', 3000],
  ['sms_owner_bypass', 400],
  ['customer_sms_reply', 1000],
  ['customer_sms_media_captured', 800],  // customer-texted photos/videos → shown inline in the thread
  ['feedback_sms_sent', 300],
  ['teddy_sms_triggered', 200],
  ['sms_gated', 400],
  ['dropped_customer_sms', 300],
];

function last10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }
function json(code, body) { return { statusCode: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) }; }

// The customer-phone-bearing fields on a row's metadata (NOT from_number/our number).
// `from` is included for INBOUND rows + media-captured events (the customer's number);
// our own number's last-10 never equals the customer's, so outbound rows aren't affected.
function rowCustomerPhone10(md) {
  return last10(md.phone) || last10(md.recipient) || last10(md.to) || last10(md.from) || '';
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
  const daysBack = Math.ceil(hoursBack / 24);

  // Reliable fallback: job-truth resolves the customer's phone from the customer record
  // even when the job's own field AND the direct customer read come back empty — the
  // same phone-on-customer-record gap that hid warranty numbers elsewhere. Without this
  // the tech-tile thread showed only inbound rows (matched by job_id) and none of our
  // outbound texts (keyed by phone). (Teddy 2026-07-07 — Jen Ross's one-sided thread.)
  if (!phone10 && jobId) {
    try {
      const site = process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net';
      const tr = await fetch(`${site}/.netlify/functions/job-truth?job_id=${jobId}&lens=office`, { signal: AbortSignal.timeout(7000) }).then((r) => r.json());
      phone10 = last10((tr && tr.facts && tr.facts.customer_phone) || '');
    } catch (_) {}
  }

  // Last-ditch: derive the phone from any inbound row tagged with this job_id.
  if (!phone10 && jobId) {
    try {
      const rows = await listEvents('inbound_customer_sms_received', daysBack, 400);
      for (const r of rows) { const md = asObj(r.metadata); if (Number(md.job_id) === jobId) { phone10 = rowCustomerPhone10(md); if (phone10) break; } }
    } catch (_) {}
  }

  if (!phone10 && !jobId && !customerId) return json(200, { ok: false, error: 'need job_id or phone', messages: [] });

  // 2) Gather every SMS row across the actions, filter to THIS conversation.
  const pages = await Promise.all(ACTIONS.map(([action, per]) => listEvents(action, daysBack, per)));

  // First gather every matched row (with its action + ts), THEN dedupe.
  const matched = [];
  pages.forEach((rows, i) => {
    const action = ACTIONS[i][0];
    for (const r of rows) {
      const ts = Number(r.created_at) || 0;
      if (ts && ts < sinceMs) continue;
      const md = asObj(r.metadata);
      const match = (phone10 && rowCustomerPhone10(md) === phone10)
        || (jobId && Number(md.job_id) === jobId)
        || (customerId && Number(md.customer_id) === customerId);
      if (!match) continue;
      matched.push({ action, md, ts });
    }
  });

  // A single office/loop send is logged TWICE: the raw `sms_sent` envelope
  // (from Xano send_sms) AND a body-bearing row (customer_sms_reply /
  // feedback_sms_sent / etc.). Both rendered as separate bubbles, so the office
  // saw every outbound text DUPLICATED. Drop the `sms_sent` envelope whenever a
  // body-bearing OUTBOUND row exists within ~12s (same conversation) — the
  // customer only got one text. sms_sent that stands alone (a plain loop send
  // with no reply row) is kept. (Teddy 2026-07-04: "sending duplicate texts")
  const ENVELOPE = 'sms_sent';
  const INBOUND = 'inbound_customer_sms_received';
  const bodyOutTs = matched.filter((m) => m.action !== ENVELOPE && m.action !== INBOUND && m.ts).map((m) => m.ts);

  const seen = new Set();
  const out = [];
  for (const m of matched) {
    if (m.action === ENVELOPE && bodyOutTs.some((t) => Math.abs(t - m.ts) <= 12000)) continue;
    const key = m.md.provider_message_id || m.md.provider_sid || (m.action + '|' + m.ts + '|' + String(m.md.body_preview || '').slice(0, 40));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ action: m.action, metadata: m.md, ts_ms: m.ts });
  }

  // 3) Chronological (oldest → newest) so the thread reads top-to-bottom.
  out.sort((a, b) => a.ts_ms - b.ts_ms);

  return json(200, { ok: true, job_id: jobId, phone: phone10, count: out.length, messages: out });
};
