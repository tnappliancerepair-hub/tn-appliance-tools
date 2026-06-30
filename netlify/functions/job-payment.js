// job-payment — one clean answer for "has this job been paid?" computed from REAL
// payment records (Stripe + recorded cash/check + quick-check), for both the office
// jobs page and the tech field app. Shows amount paid vs balance due.
//
//   GET ?job_id=  -> { ok, status, label, paid, due, balance, warranty, method }
//
// status: 'paid' (settled) · 'partial' (some paid, balance left) · 'unpaid' (owed,
//   nothing paid) · 'covered' (warranty, nothing out-of-pocket) · 'none' (no money
//   logged yet / nothing expected).
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
async function rows(action, n) { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n || 500); } catch (_) { return []; } }
// a payment row's dollar amount (handles amount / amount_cents / base_cents shapes)
function amtOf(m) {
  if (m.amount_cents != null) return num(m.amount_cents) / 100;
  if (m.base_cents != null) return num(m.base_cents) / 100;
  return num(m.amount);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const jobId = parseInt(String(q.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });
  const mine = (m) => String(m.job_id) === String(jobId);

  let job = {};
  try { job = await crud.searchOne(crud.TABLES.jobs, { id: jobId }) || {}; } catch (_) {}
  const ct = String(job.customer_type || '').toLowerCase();
  const warranty = !(ct === 'self_pay' || ct === 'cash' || ct === 'customer_pay');

  const [stripePays, offline, qc, invoices, addonRows] = await Promise.all([
    rows('customer_payment_received'), rows('payment_recorded_offline'), rows('quick_check_paid'),
    rows('office_invoice_logged'), rows('addon_fulfilled'),
  ]);

  // ---- AMOUNT PAID (real money in) ----
  let paid = 0; let lastMethod = '';
  for (const r of stripePays) { const m = meta(r); if (!mine(m)) continue; if ((m.kind || 'invoice') === 'tip') continue; paid += amtOf(m); lastMethod = lastMethod || 'card'; }
  for (const r of offline) { const m = meta(r); if (!mine(m)) continue; paid += amtOf(m); lastMethod = lastMethod || (m.method || 'cash'); }
  for (const r of qc) { const m = meta(r); if (!mine(m)) continue; paid += amtOf(m); lastMethod = lastMethod || 'card'; }

  // ---- AMOUNT DUE (latest logged invoice; else quick-check amount on the job) ----
  let due = 0;
  const inv = invoices.filter((r) => mine(meta(r)));
  if (inv.length) due = num(meta(inv[0]).amount_invoiced);
  if (!due) {
    // quick-check job with no invoice yet — the QC fee is the expectation
    const qm = qc.find((r) => mine(meta(r))); if (qm) due = amtOf(meta(qm));
  }

  // out-of-pocket add-ons (unpaid) add to what's owed even on warranty jobs
  let addonUnpaid = 0;
  for (const r of addonRows) { const m = meta(r); if (!mine(m)) continue; if (m.paid) continue; addonUnpaid += num(m.net_price || m.price); }

  paid = Number(paid.toFixed(2));
  due = Number((due + addonUnpaid).toFixed(2));
  const collectedFlag = job.payment_collected === true || String(job.payment_status || '').toLowerCase() === 'paid';

  // ---- STATUS ----
  let status, label, balance = 0;
  if (paid > 0 && (due === 0 || paid >= due)) { status = 'paid'; label = 'Paid' + (paid ? ` ($${paid.toFixed(2)})` : ''); }
  else if (paid > 0 && paid < due) { status = 'partial'; balance = Number((due - paid).toFixed(2)); label = `Partial — $${balance.toFixed(2)} due`; }
  else if (collectedFlag && due === 0) { status = 'paid'; label = 'Paid'; }
  else if (due > 0) { status = 'unpaid'; balance = due; label = `Unpaid — $${due.toFixed(2)} due`; }
  else if (warranty) { status = 'covered'; label = 'Covered by warranty — nothing due'; }
  else { status = 'none'; label = 'No payment due yet'; }

  // The tech's cut for this job, straight off the office's logged invoice — so
  // the field app shows "you made $X" the moment the office logs it (Teddy
  // 2026-06-30: one input on the office tile flows to the tech's app).
  const im = inv.length ? meta(inv[0]) : {};
  return j(200, { ok: true, job_id: jobId, status, label, paid, due, balance, warranty, method: lastMethod, collected_flag: collectedFlag, tech_pay: num(im.tech_pay), invoice_amount: num(im.amount_invoiced) });
};
