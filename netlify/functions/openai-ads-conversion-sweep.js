// openai-ads-conversion-sweep — the loop that feeds ChatGPT Ads. Finds self-pay
// jobs that have BOOKED or been PAID and uploads that conversion (matched by the
// customer's hashed phone/email) so OpenAI attributes the ones that came from a
// ChatGPT ad and learns we convert → better placement for less spend.
//
// Unlike the Google sweep there's no click-id to gate on (no gclid for v1): the
// Conversions API matches on hashed phone/email against people who saw our ads on
// OpenAI's side, so we send ALL self-pay booked/paid conversions (standard offline-
// CAPI behavior) and OpenAI does the attribution. Idempotent (dedup per job+type).
//
//   GET ?dryrun=1   show what it would upload, send nothing
//   GET             upload new conversions
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { uploadOpenAiConversion } = require('./openai-ads-upload-conversion');
const oa = require('./_lib/openai-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function amtOf(m) { if (m.amount_cents != null) return num(m.amount_cents) / 100; if (m.base_cents != null) return num(m.base_cents) / 100; return num(m.amount); }
async function rows(action, n) { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n || 400); } catch (_) { return []; } }

const SELF_PAY = new Set(['self_pay', 'cash', 'customer_pay']);
const MAX_JOBS = 25;   // cap heavy per-job reads per run (each is a metadata round-trip)

// Extended window so a manual ?dryrun=1 (which still does the per-job reads) doesn't
// hit the ~10s sync cap under Xano load. The cron run gets the full 15-min budget.
exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';

  // Fail fast (and cheap) if the key isn't vaulted yet — nothing to sweep.
  const check = await oa.creds();
  if (!check.key && !dry) return json(200, { ok: false, configured: false, note: 'OPENAI_ADS_API_KEY not vaulted — nothing uploaded' });

  const [invoices, stripePays, offline, qc, uploaded] = await Promise.all([
    rows('office_invoice_logged', 600), rows('customer_payment_received', 600),
    rows('payment_recorded_offline', 400), rows('quick_check_paid', 600),
    rows('openai_conversion_uploaded', 800),
  ]);

  // invoice (due) per job — the "booked" value signal
  const invByJob = {}; for (const r of invoices) { const m = meta(r); const id = Number(m.job_id); if (!id || invByJob[id] != null) continue; invByJob[id] = num(m.amount_invoiced); }
  // paid total per job (exclude tips)
  const paidByJob = {};
  for (const r of [...stripePays, ...offline, ...qc]) { const m = meta(r); const id = Number(m.job_id); if (!id) continue; if ((m.kind || '') === 'tip') continue; paidByJob[id] = (paidByJob[id] || 0) + amtOf(m); }

  // already uploaded (job|type)
  const done = new Set(); for (const r of uploaded) { const m = meta(r); if (m.job_id && m.event_type) done.add(m.job_id + '|' + m.event_type); }

  // candidate job ids = anything booked (invoiced) or paid
  const candidateIds = new Set([...Object.keys(invByJob), ...Object.keys(paidByJob)].map(Number).filter(Boolean));

  const plan = []; const skipped = { not_self_pay: 0, no_contact: 0, already: 0 };
  let looked = 0;
  for (const jobId of candidateIds) {
    if (looked >= MAX_JOBS) break;
    const bookedDone = done.has(jobId + '|appointment_scheduled');
    const paidDone = done.has(jobId + '|order_created');
    const wantBooked = invByJob[jobId] != null && !bookedDone;
    const wantPaid = (paidByJob[jobId] || 0) > 0 && !paidDone;
    if (!wantBooked && !wantPaid) { skipped.already++; continue; }

    looked++;
    let job = {}; try { job = await crud.searchOne(crud.TABLES.jobs, { id: jobId }) || {}; } catch (_) {}
    if (!SELF_PAY.has(String(job.customer_type || '').toLowerCase())) { skipped.not_self_pay++; continue; }
    // phone is denormalized onto the job (kanban denorm) — use it and SKIP the
    // customer-table read. Only fall back to the customer row when phone is missing
    // (or to pick up an email, which isn't denormalized) — keeps reads bounded.
    let phone = job.customer_phone || '';
    let email = '';
    if (!phone) {
      let cust = {}; try { if (job.customer_id) cust = (await crud.searchOne(crud.TABLES.customer, { id: job.customer_id })) || {}; } catch (_) {}
      phone = cust.phone || '';
      email = cust.email || '';
    }
    if (!phone && !email) { skipped.no_contact++; continue; }

    if (wantBooked) plan.push({ job_id: jobId, event_type: 'appointment_scheduled', value: invByJob[jobId] || paidByJob[jobId] || 0, phone, email });
    if (wantPaid) plan.push({ job_id: jobId, event_type: 'order_created', value: paidByJob[jobId] || invByJob[jobId] || 0, phone, email });
  }

  if (dry) return json(200, { ok: true, mode: 'dryrun', configured: !!check.key, candidates: candidateIds.size, would_upload: plan.length, skipped, plan: plan.slice(0, 20).map((p) => ({ job_id: p.job_id, event_type: p.event_type, value: p.value, has_phone: !!p.phone, has_email: !!p.email })) });

  let uploadedCount = 0; const fails = [];
  for (const p of plan) {
    const res = await uploadOpenAiConversion({ event_type: p.event_type, value: p.value, phone: p.phone, email: p.email, when_ms: Date.now(), source_url: 'https://tnapplianceexchange.net/appliance-ai.html' });
    if (res && res.ok) { uploadedCount++; try { await crud.logEvent('openai_conversion_uploaded', { job_id: p.job_id, event_type: p.event_type, value: p.value, at_ms: Date.now() }); } catch (_) {} }
    else fails.push({ job_id: p.job_id, event_type: p.event_type, error: (res && (res.raw_error || res.error)) || 'failed' });
  }
  return json(200, { ok: true, mode: 'live', uploaded: uploadedCount, failed: fails.length, fail_list: fails.slice(0, 8) });
};
