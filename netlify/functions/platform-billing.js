// platform-billing — the shop's SaaS subscription (OUR revenue billing the shop; separate
// from the shop's own customer money, which the platform never touches). Creates the Stripe
// customer + a subscription Checkout session for the modules a shop picked, and a billing-portal
// link for managing/canceling. The webhook (platform-stripe-webhook) flips company plan/features
// when payment lands.
//
//   POST { action:'checkout', company_id, plan:'office', addons:['own_area'], email }
//        -> { ok, url }                       (Stripe Checkout, subscription mode)
//   POST { action:'portal', company_id }      -> { ok, url }  (Stripe billing portal)
//   GET/POST { action:'status', company_id }  -> { ok, billing:{...} }
//
// Uses PLATFORM_STRIPE_SECRET_KEY if set (isolates SaaS revenue), else STRIPE_SECRET_KEY.
// Works in TEST mode with zero Stripe dashboard setup: if a module has no real Price ID vaulted,
// it creates an ephemeral recurring price from the catalog's placeholder amount. Owner-gated.
'use strict';

const Stripe = require('stripe');
const plans = require('../../platform/plans.js');
const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');

const SITE = 'https://tnapplianceexchange.net';

function J(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

async function stripeKey() {
  return (await getSecret('PLATFORM_STRIPE_SECRET_KEY')) || (await getSecret('STRIPE_SECRET_KEY')) || '';
}

// Resolve a module (plan or add-on) to a Stripe recurring Price id. Prefer a real vaulted
// Price id (STRIPE_PRICE_*); fall back to an ephemeral recurring price built from the
// catalog placeholder so the flow is testable before any Stripe products exist.
async function priceIdFor(stripe, mod) {
  const vaulted = mod.price_env ? String((await getSecret(mod.price_env)) || '').trim() : '';
  if (vaulted) return vaulted;
  const p = await stripe.prices.create({
    currency: 'usd',
    unit_amount: mod.price_cents,
    recurring: { interval: 'month' },
    product_data: { name: 'Ant Platform — ' + mod.label },
  });
  return p.id;
}

async function getCompany(pf, companyId) {
  const rows = await pf.get(`company?id=eq.${encodeURIComponent(companyId)}&select=id,name,slug,plan,status,billing_email,stripe_customer_id,stripe_subscription_id,billing_status,current_period_end,trial_ends_at,features`);
  return rows && rows[0];
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (_) {}
  const q = event.queryStringParameters || {};
  const action = String(body.action || q.action || '').toLowerCase();
  const companyId = body.company_id || q.company_id || '';

  // Owner gate
  const secret = body.secret || q.secret || '';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || (await getSecret('ADMIN_SECRET')) || '';
  if (!admin || secret !== admin) return J(401, { ok: false, error: 'unauthorized' });

  const pf = await platform();
  if (!pf) return J(200, { ok: false, error: 'platform_not_configured' });
  if (!companyId) return J(400, { ok: false, error: 'company_id required' });

  const company = await getCompany(pf, companyId);
  if (!company) return J(404, { ok: false, error: 'company_not_found' });

  if (action === 'status') {
    return J(200, { ok: true, billing: {
      plan: company.plan, status: company.status, billing_status: company.billing_status,
      current_period_end: company.current_period_end, trial_ends_at: company.trial_ends_at,
      has_subscription: !!company.stripe_subscription_id, features: company.features || {},
    } });
  }

  const key = await stripeKey();
  if (!key) return J(200, { ok: false, error: 'stripe_not_configured', note: 'set PLATFORM_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY) to enable billing' });
  const stripe = new Stripe(key);
  const testMode = /^sk_test_/.test(key);

  // Ensure a Stripe customer for this company.
  async function ensureCustomer(email) {
    if (company.stripe_customer_id) return company.stripe_customer_id;
    const c = await stripe.customers.create({
      name: company.name || company.slug,
      email: email || company.billing_email || undefined,
      metadata: { company_id: company.id, slug: company.slug || '' },
    });
    await pf.patch('company', `id=eq.${encodeURIComponent(company.id)}`, {
      stripe_customer_id: c.id, billing_email: email || company.billing_email || null, updated_at: new Date().toISOString(),
    });
    return c.id;
  }

  if (action === 'portal') {
    if (!company.stripe_customer_id) return J(400, { ok: false, error: 'no_stripe_customer' });
    const portal = await stripe.billingPortal.sessions.create({
      customer: company.stripe_customer_id,
      return_url: `${SITE}/platform/owner.html`,
    });
    return J(200, { ok: true, url: portal.url });
  }

  if (action === 'checkout') {
    const planKey = String(body.plan || q.plan || '').toLowerCase();
    const addons = [].concat(body.addons || (q.addons ? String(q.addons).split(',') : []))
      .map(function (s) { return String(s).toLowerCase().trim(); }).filter(Boolean);
    const base = plans.byKey(planKey);
    if (!base || !plans.PLANS.some(function (p) { return p.key === planKey; })) {
      return J(400, { ok: false, error: 'unknown_plan', plans: plans.PLANS.map(function (p) { return p.key; }) });
    }
    const mods = [base].concat(addons.map(function (k) { return plans.byKey(k); }).filter(Boolean));

    const email = body.email || q.email || company.billing_email || '';
    const customerId = await ensureCustomer(email);

    const lineItems = [];
    for (const m of mods) lineItems.push({ price: await priceIdFor(stripe, m), quantity: 1 });

    // Optional free trial (days) — owner sets via body.trial_days; 0 = charge immediately.
    const trialDays = Math.max(0, parseInt(body.trial_days || q.trial_days || '0', 10) || 0);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      subscription_data: Object.assign(
        { metadata: { company_id: company.id, plan: planKey, addons: addons.join(',') } },
        trialDays > 0 ? { trial_period_days: trialDays } : {}
      ),
      metadata: { company_id: company.id, plan: planKey, addons: addons.join(',') },
      success_url: `${SITE}/platform/owner.html?billing=success`,
      cancel_url: `${SITE}/platform/signup.html?billing=cancel`,
    });

    return J(200, { ok: true, url: session.url, session_id: session.id, test_mode: testMode,
      plan: planKey, addons: addons });
  }

  return J(400, { ok: false, error: 'unknown_action', actions: ['checkout', 'portal', 'status'] });
};
