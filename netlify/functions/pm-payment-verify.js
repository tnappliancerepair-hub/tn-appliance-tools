// pm-payment-verify — close the loop after a PM pays via the pm-invoice-link. Given the
// Stripe checkout session, it confirms the payment is really paid (Stripe is the auth),
// then: marks the JOB paid so the board tile shows PAID, sets the just-saved card as the
// customer's default so future jobs auto-charge, logs the payment (books + dedup), and
// alerts Teddy. Idempotent per session. Runs from the success page AND as a webhook backstop.
//
//   GET/POST ?session_id=<cs_...>   -> { ok, paid, job_id, company, amount_cents }
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const SITE = 'https://tnapplianceexchange.net', OWNER = '+16154855795';
exports.config = { timeout: 22 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }
const s = (v) => String(v == null ? '' : v).trim();
const dollars = (c) => '$' + ((Number(c) || 0) / 100).toFixed(2);
async function logRow(a, m) { const h = authH(); if (!h) return; try { await fetch(`${META}/table/3/content`, { method: 'POST', headers: h, body: JSON.stringify({ action: a, metadata: m }) }); } catch (_) {} }
async function alreadyDone(sessionId) {
  const h = authH(); if (!h) return false;
  try { const r = await fetch(`${META}/table/3/content/search`, { method: 'POST', headers: h, body: JSON.stringify({ search: { action: 'pm_payment' }, sort: { id: 'desc' }, per_page: 500 }) }); return ((await r.json()).items || []).some((x) => (x.metadata || {}).session_id === sessionId); } catch (_) { return false; }
}

exports.handler = async function (event) {
  const sessionId = s((event.queryStringParameters || {}).session_id) || (() => { try { return s(JSON.parse(event.body || '{}').session_id); } catch (_) { return ''; } })();
  if (!sessionId) return json(400, { ok: false, error: 'session_id required' });
  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return json(500, { ok: false, error: 'stripe_not_configured' });
  const stripe = new Stripe(key);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    if (!session) return json(404, { ok: false, error: 'session_not_found' });
    const md = session.metadata || {};
    if (session.payment_status !== 'paid') return json(200, { ok: true, paid: false, status: session.payment_status });
    const jobId = parseInt(md.job_id, 10) || 0;
    const pmKey = s(md.pm_key);
    const invNo = s(md.invoice_number);
    const amount = Number(session.amount_total) || parseInt(md.amount_cents, 10) || 0;

    if (await alreadyDone(sessionId)) return json(200, { ok: true, paid: true, already: true, job_id: jobId, amount_cents: amount });

    // 1) set the just-saved card as the customer's default -> future auto-charges use it.
    try {
      const pi = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
      const pmId = pi && pi.payment_method;
      if (session.customer && pmId) await stripe.customers.update(session.customer, { invoice_settings: { default_payment_method: pmId } });
    } catch (_) {}

    // 2) mark the JOB paid so the board tile reads PAID.
    if (jobId) {
      const h = authH();
      if (h) { try { await fetch(`${META}/table/7/content/${jobId}`, { method: 'PUT', headers: h, body: JSON.stringify({ payment_status: 'paid', payment_collected: true, paid_at: Date.now() }) }); } catch (_) {} }
      try { await fetch(`${SITE}/.netlify/functions/mark-invoice-paid`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, paid: true, by: 'PM (online)', method: 'pm_link' }) }); } catch (_) {}
    }

    // 3) record the payment (books + dedup for pm-autocharge).
    await logRow('pm_payment', { session_id: sessionId, job_id: String(jobId || ''), pm_key: pmKey, company: md.company || '', invoice_number: invNo, amount_cents: amount, source: 'pm_invoice_link', paid_at_ms: Date.now() });

    // 4) confirm to Teddy.
    try { await sendSms(OWNER, '[ant] 💳 PAID: ' + (md.company || pmKey) + ' — ' + (invNo || ('job #' + jobId)) + ' ' + dollars(amount) + ' ✓. Card is now on file for auto-billing.', 'owner', 'pm_paid'); } catch (_) {}

    return json(200, { ok: true, paid: true, job_id: jobId, company: md.company || '', invoice_number: invNo, amount_cents: amount });
  } catch (err) { return json(500, { ok: false, error: err.message }); }
};
