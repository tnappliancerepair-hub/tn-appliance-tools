// pm-pay — a short, branded, always-valid pay link for a PM invoice. The office sends
// tnapplianceexchange.net/pay?job=20436 (clean + clearly clickable) instead of the giant
// Stripe URL. On each click it looks up the stored invoice, mints a FRESH Stripe Checkout
// (pay + save card), and 302-redirects to it — so the link never expires. Opening it never
// charges anyone; only completing the Stripe page does.
//
//   GET /pay?job=<id>   (via _redirects)  ->  302 to a fresh Stripe checkout
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { getPmAccount } = require('./_lib/pm-accounts');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const SITE = 'https://tnapplianceexchange.net';
exports.config = { timeout: 20 };
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
const s = (v) => String(v == null ? '' : v).trim();
function errPage(msg) { return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:420px;margin:60px auto;text-align:center;color:#1a1d24;padding:20px"><div style="font-size:44px">🐜</div><h2>' + msg + '</h2><p style="color:#6b7280">Please call us at <a href="tel:6152802949" style="color:#ff6200">615-280-2949</a> and we\'ll sort it out.</p></div>' }; }

async function latestInvoice(jobId, pmKey) {
  const r = await fetch(`${META}/table/3/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { action: 'pm_invoice' }, sort: { id: 'desc' }, per_page: 400 }) });
  if (!r.ok) return null;
  const rows = (await r.json()).items || [];
  for (const row of rows) { const m = row.metadata || {}; if ((jobId && String(m.job_id) === String(jobId)) || (pmKey && !jobId && m.pm_key === pmKey)) return m; }
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const jobId = s(q.job);
  const pmKey = s(q.pm);
  if (!jobId && !pmKey) return errPage('This payment link is missing its reference.');
  try {
    const inv = await latestInvoice(jobId, pmKey);
    if (!inv) return errPage('We couldn\'t find that invoice.');
    const acct = await getPmAccount(inv.pm_key);
    if (!acct || !acct.stripe_customer_id) return errPage('This account isn\'t set up for online payment yet.');
    const subtotal = Math.round(Number(inv.subtotal_cents) || 0);
    const tax = Math.round(Number(inv.tax_cents) || 0);
    if (subtotal <= 0) return errPage('This invoice has no balance due.');

    const key = await getSecret('STRIPE_SECRET_KEY');
    if (!key) return errPage('Online payment is temporarily unavailable.');
    const stripe = new Stripe(key);
    const invNo = s(inv.invoice_number), description = s(inv.description) || 'Appliance repair';
    const line_items = [{ price_data: { currency: 'usd', product_data: { name: (invNo ? (invNo + ' — ') : '') + description }, unit_amount: subtotal }, quantity: 1 }];
    if (tax > 0) line_items.push({ price_data: { currency: 'usd', product_data: { name: 'TN sales tax (9.75%)' }, unit_amount: tax }, quantity: 1 });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: acct.stripe_customer_id,
      line_items,
      payment_intent_data: { setup_future_usage: 'off_session', description: (invNo || description), metadata: { pm_key: inv.pm_key, invoice_number: invNo, job_id: String(jobId || ''), source: 'pm_invoice_link' } },
      success_url: `${SITE}/pm-card-saved.html?pm=${encodeURIComponent(inv.pm_key)}&paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/pm-card-saved.html?pm=${encodeURIComponent(inv.pm_key)}&canceled=1`,
      metadata: { pm_key: inv.pm_key, company: inv.company || '', invoice_number: invNo, job_id: String(jobId || ''), amount_cents: String(subtotal + tax), source: 'pm_invoice_link' },
    });
    return { statusCode: 302, headers: { Location: session.url, 'cache-control': 'no-store' }, body: '' };
  } catch (err) { return errPage('Something went wrong opening your payment page.'); }
};
