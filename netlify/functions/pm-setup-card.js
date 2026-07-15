// pm-setup-card — stand up a property-management billing account and get a secure link for
// the PM to put a card on file. The card is entered on STRIPE's hosted page (Checkout in
// setup mode) and stored on the Stripe customer — we never see or store the card number.
// Admin-gated (this creates billing accounts). The office sends the returned URL to the PM.
//
// POST { secret, company, pm_key?, email?, contact?, phone?, track?, threshold_cents? }
//   -> { ok, pm_key, stripe_customer_id, setup_url }
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { getPmAccount, upsertPmAccount, pmSlug } = require('./_lib/pm-accounts');
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n).trim();
const SITE = 'https://tnapplianceexchange.net';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
  if (s(b.secret, 80) !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const company = s(b.company, 120);
  const pmKey = s(b.pm_key, 60) || pmSlug(company);
  if (!company || !pmKey) return json(400, { ok: false, error: 'company required' });
  const email = s(b.email, 120), contact = s(b.contact, 80), phone = s(b.phone, 40);
  const track = (s(b.track, 20) === 'net_terms') ? 'net_terms' : 'card';
  // Pre-authorization / NTE (Not-To-Exceed) limit: PMs pre-authorize repairs up to this
  // amount; anything over needs additional authorization first. $400 is the standard
  // PM pre-auth (Teddy 2026-07-15). Editable per account.
  const threshold = Math.max(0, parseInt(b.threshold_cents, 10) || 40000);

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return json(500, { ok: false, error: 'stripe_not_configured' });
  const stripe = new Stripe(key);

  try {
    const acct = (await getPmAccount(pmKey)) || {};
    let customerId = acct.stripe_customer_id;
    if (!customerId) {
      const cust = await stripe.customers.create({ name: company, email: email || undefined, phone: phone || undefined, description: 'Property management account', metadata: { pm_key: pmKey } });
      customerId = cust.id;
    }

    // Persist the account config.
    const saved = await upsertPmAccount(pmKey, {
      company, email, contact, phone, track, threshold_cents: threshold,
      stripe_customer_id: customerId,
    });

    // Hosted Checkout in setup mode collects + saves the card to the customer (no charge).
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      payment_method_types: ['card'],
      success_url: `${SITE}/pm-card-saved.html?pm=${encodeURIComponent(pmKey)}`,
      cancel_url: `${SITE}/pm-card-saved.html?pm=${encodeURIComponent(pmKey)}&canceled=1`,
      metadata: { pm_key: pmKey, purpose: 'save_card' },
    });

    return json(200, { ok: true, pm_key: pmKey, stripe_customer_id: customerId, track: saved.track, threshold_cents: saved.threshold_cents, setup_url: session.url });
  } catch (err) {
    console.error('[pm-setup-card] stripe error', err.message);
    return json(500, { ok: false, error: err.message });
  }
};
