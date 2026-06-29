// google-ads-conversion-sweep — the loop that feeds Google Ads. Finds self-pay jobs
// that came from an ad click (have a gclid) and have since BOOKED or been PAID, and
// uploads that conversion (with $ value) so Google learns which clicks make real
// out-of-pocket jobs. Idempotent (dedup per job+action). Runs on a schedule.
//
//   GET ?dryrun=1   show what it would upload, send nothing
//   GET             upload new conversions
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const { uploadConversion } = require('./google-ads-upload-conversion');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function amtOf(m) { if (m.amount_cents != null) return num(m.amount_cents) / 100; if (m.base_cents != null) return num(m.base_cents) / 100; return num(m.amount); }
async function rows(action, n) { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n || 400); } catch (_) { return []; } }

const BOOKED = new Set(['scheduled', 'in_progress', 'completed', 'awaiting_parts', 'held', 'escalated']);
const SELF_PAY = new Set(['self_pay', 'cash', 'customer_pay']);

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';

  const [clicks, invoices, stripePays, offline, qc, created, uploaded] = await Promise.all([
    rows('ad_click', 600), rows('office_invoice_logged', 600), rows('customer_payment_received', 600),
    rows('payment_recorded_offline', 400), rows('quick_check_paid', 600), rows('free_quick_check_created', 600), rows('gads_conversion_uploaded', 800),
  ]);

  // conv_id -> job_id, so an ad click captured before the job existed (Stripe pay-first
  // path) still ties to its job. Both quick_check_paid + free_quick_check_created carry both.
  const convToJob = {};
  for (const r of [...qc, ...created]) { const m = meta(r); const cv = String(m.conv_id || ''); const id = Number(m.job_id) || 0; if (cv && id && !convToJob[cv]) convToJob[cv] = id; }

  // gclid per job (latest) — resolve job_id via conv_id when the click row has none
  const clickByJob = {};
  for (const r of clicks) {
    const m = meta(r);
    let id = Number(m.job_id) || 0;
    if (!id && m.conv_id) id = convToJob[String(m.conv_id)] || 0;
    if (!id) continue; if (clickByJob[id]) continue;
    if (!(m.gclid || m.gbraid || m.wbraid)) continue;
    clickByJob[id] = { gclid: m.gclid || '', gbraid: m.gbraid || '', wbraid: m.wbraid || '', at_ms: Number(m.at_ms) || Number(r.created_at) || Date.now() };
  }

  // invoice (due) + paid total per job
  const invByJob = {}; for (const r of invoices) { const m = meta(r); const id = Number(m.job_id); if (!id || invByJob[id] != null) continue; invByJob[id] = num(m.amount_invoiced); }
  const paidByJob = {};
  for (const r of [...stripePays, ...offline, ...qc]) { const m = meta(r); const id = Number(m.job_id); if (!id) continue; if ((m.kind || '') === 'tip') continue; paidByJob[id] = (paidByJob[id] || 0) + amtOf(m); }

  // already uploaded (job|action)
  const done = new Set(); for (const r of uploaded) { const m = meta(r); if (m.job_id && m.action) done.add(m.job_id + '|' + m.action); }

  const plan = [];
  for (const jobIdStr of Object.keys(clickByJob)) {
    const jobId = Number(jobIdStr);
    let job = {}; try { job = await crud.searchOne(crud.TABLES.jobs, { id: jobId }) || {}; } catch (_) {}
    if (!SELF_PAY.has(String(job.customer_type || '').toLowerCase())) continue;  // out-of-pocket only
    const click = clickByJob[jobId];
    const ss = String(job.scheduling_status || '').toLowerCase();
    const paid = (paidByJob[jobId] || 0) > 0 || String(job.payment_status || '').toLowerCase() === 'paid' || job.payment_collected === true;

    // BOOKED conversion (value = invoice if logged, else what's paid, else 0)
    if (BOOKED.has(ss) && !done.has(jobId + '|booked')) {
      plan.push({ job_id: jobId, action: 'booked', value: invByJob[jobId] || paidByJob[jobId] || 0, click });
    }
    // PAID conversion (value = amount actually paid)
    if (paid && !done.has(jobId + '|paid')) {
      plan.push({ job_id: jobId, action: 'paid', value: paidByJob[jobId] || invByJob[jobId] || 0, click });
    }
  }

  if (dry) return json(200, { ok: true, mode: 'dryrun', clicks_seen: Object.keys(clickByJob).length, would_upload: plan.length, plan: plan.slice(0, 20) });

  let uploadedCount = 0; const fails = [];
  for (const p of plan) {
    const res = await uploadConversion({ gclid: p.click.gclid, gbraid: p.click.gbraid, wbraid: p.click.wbraid, action: p.action, value: p.value, when_ms: p.click.at_ms });
    if (res && res.ok) { uploadedCount++; try { await crud.logEvent('gads_conversion_uploaded', { job_id: p.job_id, action: p.action, value: p.value, at_ms: Date.now() }); } catch (_) {} }
    else fails.push({ job_id: p.job_id, action: p.action, error: (res && (res.partial_error || res.raw_error || res.error)) || 'failed' });
  }
  return json(200, { ok: true, mode: 'live', uploaded: uploadedCount, failed: fails.length, fail_list: fails.slice(0, 8) });
};
