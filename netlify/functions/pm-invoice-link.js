// pm-invoice-link — ONE secure link that (1) lets a PM pay an invoice now and (2) saves
// their card on file for future hands-off billing, in a single Stripe Checkout. Uses
// mode:payment + payment_intent_data.setup_future_usage='off_session' attached to the PM's
// Stripe customer: they tap once, the invoice is paid, and the card is saved so pm-charge /
// pm-autocharge can bill future completed jobs automatically. Easy for them, easy for us.
// Admin-gated; find-or-creates the PM account + Stripe customer.
//
// POST { secret, company, pm_key?, email?, phone?, contact?, subtotal_cents, tax_cents?,
//        description, invoice_number?, job_id? }  ->  { ok, pm_key, pay_url }
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { getPmAccount, upsertPmAccount, pmSlug } = require('./_lib/pm-accounts');
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 200 : n).trim();
const SITE = 'https://tnapplianceexchange.net';
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
function authH() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
  if (s(b.secret, 80) !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const company = s(b.company, 120);
  const pmKey = s(b.pm_key, 60) || pmSlug(company);
  if (!pmKey) return json(400, { ok: false, error: 'company or pm_key required' });
  const subtotal = Math.round(Number(b.subtotal_cents) || 0);
  const tax = Math.round(Number(b.tax_cents) || 0);
  if (subtotal <= 0) return json(400, { ok: false, error: 'subtotal_cents required' });
  const invoiceNo = s(b.invoice_number, 40);
  const jobId = s(b.job_id, 20);
  const description = s(b.description, 200) || ('Appliance repair' + (jobId ? (' — job #' + jobId) : ''));
  const email = s(b.email, 120), phone = s(b.phone, 40), contact = s(b.contact, 80);

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return json(500, { ok: false, error: 'stripe_not_configured' });
  const stripe = new Stripe(key);

  try {
    // find-or-create the PM account + Stripe customer
    const acct = (await getPmAccount(pmKey)) || {};
    let customerId = acct.stripe_customer_id;
    if (!customerId) {
      const cust = await stripe.customers.create({ name: company || acct.company, email: email || acct.email || undefined, phone: phone || acct.phone || undefined, description: 'Property management account', metadata: { pm_key: pmKey } });
      customerId = cust.id;
    }
    await upsertPmAccount(pmKey, Object.assign({ company: company || acct.company, track: acct.track || 'card', threshold_cents: acct.threshold_cents || 40000, stripe_customer_id: customerId }, email ? { email } : {}, phone ? { phone } : {}, contact ? { contact } : {}));

    const line_items = [{ price_data: { currency: 'usd', product_data: { name: (invoiceNo ? (invoiceNo + ' — ') : '') + description }, unit_amount: subtotal }, quantity: 1 }];
    if (tax > 0) line_items.push({ price_data: { currency: 'usd', product_data: { name: 'TN sales tax (9.75%)' }, unit_amount: tax }, quantity: 1 });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items,
      // THE KEY: charge now AND save the card for future off-session billing.
      payment_intent_data: { setup_future_usage: 'off_session', description: (invoiceNo || description), metadata: { pm_key: pmKey, invoice_number: invoiceNo, job_id: jobId, source: 'pm_invoice_link' } },
      success_url: `${SITE}/pm-card-saved.html?pm=${encodeURIComponent(pmKey)}&paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/pm-card-saved.html?pm=${encodeURIComponent(pmKey)}&canceled=1`,
      metadata: { pm_key: pmKey, invoice_number: invoiceNo, job_id: jobId, amount_cents: String(subtotal + tax), source: 'pm_invoice_link' },
    });

    // Remember this invoice's params so a short branded link (/pay?job=NN) can
    // regenerate a fresh, always-valid Stripe session on each click.
    try {
      const h = authH();
      if (h) await fetch(`${META}/table/3/content`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'pm_invoice', metadata: { job_id: jobId, pm_key: pmKey, company: company || acct.company, subtotal_cents: subtotal, tax_cents: tax, description, invoice_number: invoiceNo, email: email || acct.email || '', contact: contact || acct.contact || '', at_ms: Date.now() } }) });
    } catch (_) {}

    return json(200, { ok: true, pm_key: pmKey, stripe_customer_id: customerId, amount_cents: subtotal + tax, pay_url: session.url, short_url: jobId ? (SITE + '/pay?job=' + jobId) : undefined });
  } catch (err) {
    console.error('[pm-invoice-link] stripe error', err.message);
    return json(500, { ok: false, error: err.message });
  }
};
