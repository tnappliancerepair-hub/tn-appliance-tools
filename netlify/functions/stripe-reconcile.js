// stripe-reconcile — the missing half of the Cash Customers system. Pulls succeeded
// Stripe payments and links them back to cash jobs so a PAID buyer actually shows paid
// (and jumps to the top "PAID — schedule now" lane). Guest Link payments carry no
// job_id, so we auto-match the strong cases (metadata.job_id, phone) and PERSIST the
// rest as "unmatched" for one-tap assignment on the cash board instead of guessing —
// never mis-credit a payment.
//
//   GET  ?secret=<admin>[&days=45]     -> reconcile: auto-record strong matches, log unmatched
//   POST {action:'link', charge_id, job_id, amount, name, office_pw|secret}
//        -> attach an unmatched payment to a job (records it paid, idempotent)
//   (also runs hourly on a schedule to keep matches + the unmatched list current)
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function d10(p) { const x = String(p || '').replace(/\D/g, ''); return x.length >= 10 ? x.slice(-10) : ''; }

async function recordPaid(jobId, amount, chargeId, source, extra) {
  await crud.logEvent('customer_payment_received', { job_id: jobId, amount: Number(amount).toFixed(2), kind: 'cash', session_id: chargeId, source: source || 'stripe_reconcile', stripe_charge_id: chargeId, at_ms: Date.now(), ...(extra || {}) });
  await crud.logEvent('stripe_payment_reconciled', { charge_id: chargeId, job_id: jobId, amount: Number(amount).toFixed(2), source: source || 'stripe_reconcile', at_ms: Date.now() });
}

// Everything we've already handled — so re-runs are idempotent and we don't double-
// count a job verify-payment/webhook already marked paid, or re-log the same unmatched.
async function loadHandled() {
  const reconciled = new Set(), paidJobs = new Set(), unmatchedLogged = new Set();
  const pull = async (action) => { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, 500); } catch (_) { return []; } };
  for (const r of await pull('stripe_payment_reconciled')) { const m = meta(r); if (m.charge_id) reconciled.add(String(m.charge_id)); }
  for (const r of await pull('customer_payment_received')) { const m = meta(r); if (m.job_id) paidJobs.add(String(m.job_id)); }
  for (const r of await pull('stripe_payment_unmatched')) { const m = meta(r); if (m.charge_id) unmatchedLogged.add(String(m.charge_id)); }
  return { reconciled, paidJobs, unmatchedLogged };
}

async function jobByPhone(phone) {
  const ph = d10(phone); if (!ph) return 0;
  try {
    const d = await fetch(`${XANO}/lookup_customer_by_phone?phone=${ph}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const opens = (d && d.open_jobs) || [];
    const cash = opens.find((j) => !(j.warranty_company || '').trim());
    return Number((cash || opens[0] || {}).id) || 0;
  } catch (_) { return 0; }
}

async function officePwOk(pw) {
  if (!pw) return false;
  try { const d = await fetch(`${SITE}/office-verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }), signal: AbortSignal.timeout(8000) }).then((r) => r.json()); return !!(d && (d.ok || d.valid || d.success)); } catch (_) { return false; }
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const scheduled = !!(event && event.body && (() => { try { return JSON.parse(event.body).next_run; } catch (_) { return false; } })());
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD;
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  // ---- POST: manual link of an unmatched payment to a job (office-password OK) ----
  if (event.httpMethod === 'POST' && body.action === 'link') {
    const ok = (body.secret === admin || body.secret === GUARD) || await officePwOk(body.office_pw);
    if (!ok) return json(403, { ok: false, error: 'forbidden' });
    const jobId = Number(body.job_id) || 0; const chargeId = String(body.charge_id || ''); const amount = Number(body.amount) || 0;
    if (!jobId || !chargeId) return json(400, { ok: false, error: 'job_id + charge_id required' });
    try { await recordPaid(jobId, amount, chargeId, 'stripe_manual_link', { linked_name: String(body.name || '') }); await crud.logEvent('stripe_payment_matched', { charge_id: chargeId, job_id: jobId, at_ms: Date.now() }); }
    catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
    return json(200, { ok: true, linked: { charge_id: chargeId, job_id: jobId, amount } });
  }

  // ---- GET / scheduled: reconcile ----
  if (!scheduled && q.secret !== admin && q.secret !== GUARD) return json(403, { ok: false, error: 'forbidden' });
  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return json(200, { ok: false, error: 'stripe_not_configured' });
  const stripe = Stripe(key);
  const days = Math.max(1, Math.min(120, Number(q.days) || 45));
  const sinceSec = Math.floor((Date.now() - days * 86400000) / 1000);

  let charges = [];
  try { const res = await stripe.charges.list({ limit: 100, created: { gte: sinceSec }, expand: ['data.payment_intent'] }); charges = (res && res.data) || []; }
  catch (e) { return json(200, { ok: false, error: 'stripe_list_failed: ' + String((e && e.message) || e).slice(0, 160) }); }

  const { reconciled, paidJobs, unmatchedLogged } = await loadHandled();
  const matched = [], unmatched = [];
  let lookups = 0; const LOOKUP_CAP = 30;   // bound sequential Xano phone lookups so the 26s budget holds

  for (const ch of charges) {
    if (ch.status !== 'succeeded' || ch.refunded) continue;
    const chargeId = ch.id;
    if (reconciled.has(String(chargeId))) continue;
    const amount = (ch.amount || 0) / 100;
    const bd = ch.billing_details || {};
    const pi = (ch.payment_intent && typeof ch.payment_intent === 'object') ? ch.payment_intent : {};
    const mdJob = Number((pi.metadata && pi.metadata.job_id) || (ch.metadata && ch.metadata.job_id) || 0) || 0;
    const name = bd.name || (pi.metadata && pi.metadata.name) || '';
    const email = bd.email || ch.receipt_email || '';
    const phone = bd.phone || (pi.metadata && pi.metadata.phone) || '';

    let jobId = mdJob; let matchedBy = mdJob ? 'metadata_job_id' : '';
    if (!jobId && d10(phone) && lookups < LOOKUP_CAP) { lookups++; const jp = await jobByPhone(phone); if (jp) { jobId = jp; matchedBy = 'phone'; } }

    if (jobId) {
      if (paidJobs.has(String(jobId))) { try { await crud.logEvent('stripe_payment_reconciled', { charge_id: chargeId, job_id: jobId, amount: amount.toFixed(2), source: 'already_paid', at_ms: Date.now() }); } catch (_) {} continue; }
      try { await recordPaid(jobId, amount, chargeId, 'stripe_reconcile', { matched_by: matchedBy }); matched.push({ charge_id: chargeId, job_id: jobId, amount, matched_by: matchedBy, name }); paidJobs.add(String(jobId)); } catch (_) {}
    } else {
      unmatched.push({ charge_id: chargeId, amount, name, email, phone, created: (ch.created || 0) * 1000 });
      // persist so the cash board can surface it (dedup — log a charge only once)
      if (!unmatchedLogged.has(String(chargeId))) { try { await crud.logEvent('stripe_payment_unmatched', { charge_id: chargeId, amount: amount.toFixed(2), name, email, phone, created: (ch.created || 0) * 1000, at_ms: Date.now() }); } catch (_) {} }
    }
  }

  return json(200, { ok: true, window_days: days, scanned: charges.length, matched_count: matched.length, unmatched_count: unmatched.length, matched, unmatched });
};
