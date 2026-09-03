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
  // Prefer a dedicated platform key; fall back to TN's Stripe account (Teddy 2026-08-28:
  // no separate Ant business yet — bill on the same account for now). Products are named
  // "Ant Platform — …" so SaaS subscriptions are distinguishable from customer payments.
  // Swap PLATFORM_STRIPE_SECRET_KEY in later = one-key move to a separate account.
  return (await getSecret('PLATFORM_STRIPE_SECRET_KEY')) || (await getSecret('STRIPE_SECRET_KEY')) || '';
}
const TRIAL_DAYS = 14;

// Resolve a module (plan or add-on) to a Stripe recurring Price id. Prefer a real vaulted
// Price id (STRIPE_PRICE_*); fall back to an ephemeral recurring price built from the
// catalog placeholder so the flow is testable before any Stripe products exist.
async function priceIdFor(stripe, mod) {
  const vaulted = mod.price_env ? String((await getSecret(mod.price_env)) || '').trim() : '';
  if (vaulted) return vaulted;
  // Reuse a stable price by lookup_key so repeat checkouts don't spawn duplicate $99 prices.
  const p = await ensurePrice(stripe, 'ant_' + mod.key + '_mo', {
    unit_amount: mod.price_cents, recurring: { interval: 'month' },
    product_data: { name: 'Ant Platform — ' + mod.label },
  });
  return p.id;
}

// Create/find the named monthly prices for every plan + add-on (idempotent via lookup_key).
// Returns a { STRIPE_PRICE_*: priceId } map to vault (optional — checkout reuses them regardless).
async function ensureMonthlyCatalog(stripe) {
  const out = {};
  const mods = plans.PLANS.concat(plans.ADDONS);
  for (const m of mods) {
    const p = await ensurePrice(stripe, 'ant_' + m.key + '_mo', {
      unit_amount: m.price_cents, recurring: { interval: 'month' },
      product_data: { name: 'Ant Platform — ' + m.label },
    });
    if (m.price_env) out[m.price_env] = p.id;
  }
  return out;
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

  // Owner gate (same fallback provision uses — the vault key can cold-miss)
  const secret = body.secret || q.secret || '';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (secret !== admin) return J(401, { ok: false, error: 'unauthorized' });

  const pf = await platform();
  if (!pf) return J(200, { ok: false, error: 'platform_not_configured' });

  // setup_ann — one-time: create the Ann products/meters/prices in Stripe + return the ids to
  // vault. No company needed. Idempotent (reuses existing meters/prices by lookup_key).
  if (action === 'setup_ann') {
    const key = await stripeKey();
    if (!key) return J(200, { ok: false, error: 'stripe_not_configured', note: 'set PLATFORM_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY) first' });
    const stripe = new Stripe(key);
    let cat; try { cat = await module.exports.ensureAnnCatalog(stripe); }
    catch (e) { return J(200, { ok: false, error: 'stripe_err', detail: String((e && e.message) || e).slice(0, 200) }); }
    return J(200, { ok: true, test_mode: /^sk_test_/.test(key), created: cat,
      vault_these: {
        STRIPE_PRICE_ANN_BASE: cat.base,
        STRIPE_PRICE_ANN_MIN_OVERAGE: cat.min,
        STRIPE_PRICE_ANN_TEXT_OVERAGE: cat.text,
      },
      note: 'Vault the 3 STRIPE_PRICE_ANN_* ids. Meter event names (ann_minutes/ann_texts) are code constants — no vault needed.' });
  }

  // setup_plans — one-time: create the monthly software + add-on prices in Stripe + return ids.
  if (action === 'setup_plans') {
    const key = await stripeKey();
    if (!key) return J(200, { ok: false, error: 'stripe_not_configured', note: 'set PLATFORM_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY) first' });
    const stripe = new Stripe(key);
    let cat; try { cat = await module.exports.ensureMonthlyCatalog(stripe); }
    catch (e) { return J(200, { ok: false, error: 'stripe_err', detail: String((e && e.message) || e).slice(0, 200) }); }
    return J(200, { ok: true, test_mode: /^sk_test_/.test(key), vault_these: cat,
      note: 'Optional — checkout already reuses these by lookup_key even unvaulted. Vaulting just pins the exact ids.' });
  }

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

// signupCheckout — provision-on-payment. Called by platform-signup BEFORE any tenant exists:
// creates a subscription Checkout that REQUIRES A CARD (payment_method_collection:'always'),
// stashing the shop details in metadata. No tenant is created here — the webhook provisions
// only after checkout completes, so a scammer who never enters a card never gets a tenant.
// Returns { ok, url } or { ok:false, error }.
async function signupCheckout(opts) {
  const key = await stripeKey();
  if (!key) return { ok: false, error: 'stripe_not_configured' };
  const stripe = new Stripe(key);

  const planKey = String(opts.plan || '').toLowerCase();
  const addons = (opts.addons || []).map(function (s) { return String(s).toLowerCase().trim(); }).filter(Boolean);
  const base = plans.byKey(planKey);
  if (!base || !plans.PLANS.some(function (p) { return p.key === planKey; })) return { ok: false, error: 'unknown_plan' };
  const mods = [base].concat(addons.map(function (k) { return plans.byKey(k); }).filter(Boolean));

  const lineItems = [];
  for (const m of mods) lineItems.push({ price: await priceIdFor(stripe, m), quantity: 1 });

  // Everything the webhook needs to stand up the tenant once the card clears. (Stripe metadata
  // values cap at 500 chars — all short fields here.)
  const provMeta = {
    company_provision: '1',
    name: String(opts.name || '').slice(0, 200),
    slug: String(opts.slug || '').slice(0, 60),
    trade: String(opts.trade || 'appliance').slice(0, 40),
    plan: planKey,
    addons: addons.join(','),
    owner_name: String(opts.owner_name || '').slice(0, 120),
    owner_phone: String(opts.phone || '').slice(0, 40),
    email: String(opts.email || '').slice(0, 200),
    want_ann: opts.want_ann ? '1' : '',
    ref: String(opts.ref || '').slice(0, 60),   // referral partner code (reseller attribution)
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: opts.email || undefined,
    line_items: lineItems,
    payment_method_collection: 'always',          // card required even with a trial
    subscription_data: { trial_period_days: TRIAL_DAYS, metadata: provMeta },
    metadata: provMeta,
    // Carry the session id back so provision-on-redirect (platform-signup-verify) can stand up
    // the tenant immediately, with no dependency on the webhook signing secret.
    success_url: `${SITE}/platform/signup.html?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/platform/signup.html?billing=cancel`,
  });
  return { ok: true, url: session.url, session_id: session.id, test_mode: /^sk_test_/.test(key) };
}

module.exports.signupCheckout = signupCheckout;

// ── ANN METERED BILLING (Stripe Billing Meters API) ─────────────────────────
// Ann is the ONE metered product: a weekly flat base ($50, includes 400 min + 100 texts)
// + two metered overage prices (minutes over 400 @ $0.40, texts over 100 @ $0.05). Stripe
// now REQUIRES a backing Billing Meter for every metered price (the legacy usage-records
// path is deprecated), so we create two meters and report usage as METER EVENTS keyed to the
// tenant's Stripe customer. platform-usage-bill reports each completed week's overage.
//
// Reporting is customer-scoped via event_name (constants below) — no per-item ids needed.
const ANN_MIN_EVENT = 'ann_minutes';   // meter event_name for minute overage
const ANN_TEXT_EVENT = 'ann_texts';    // meter event_name for text overage

// Find an active meter by event_name, else create it (aggregation = sum, mapped to the
// customer by id, value read from payload.value). Idempotent — never duplicates a meter.
async function ensureMeter(stripe, eventName, displayName) {
  const list = await stripe.billing.meters.list({ status: 'active', limit: 100 });
  const found = (list.data || []).find(function (m) { return m.event_name === eventName; });
  if (found) return found;
  return stripe.billing.meters.create({
    display_name: displayName,
    event_name: eventName,
    default_aggregation: { formula: 'sum' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    value_settings: { event_payload_key: 'value' },
  });
}

// Find a price by lookup_key (stable, unique-ish), else create it. Keeps setup idempotent so
// re-running doesn't litter the dashboard with duplicate prices.
async function ensurePrice(stripe, lookupKey, spec) {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (found.data && found.data[0]) return found.data[0];
  return stripe.prices.create(Object.assign({ lookup_key: lookupKey, currency: 'usd' }, spec));
}

// Ensure the full Ann catalog exists in Stripe (2 meters + 3 prices). Idempotent. Returns the
// ids. This is what the setup action creates + what billing falls back to when no ids are vaulted.
async function ensureAnnCatalog(stripe) {
  const A = plans.ANN;
  const minMeter = await ensureMeter(stripe, ANN_MIN_EVENT, 'Ann minute overage');
  const textMeter = await ensureMeter(stripe, ANN_TEXT_EVENT, 'Ann text overage');
  const base = await ensurePrice(stripe, 'ann_base_wk', {
    unit_amount: A.base_cents, recurring: { interval: 'week' },
    product_data: { name: 'Ant Platform — Ann (weekly base)' },
  });
  const min = await ensurePrice(stripe, 'ann_min_overage_wk', {
    unit_amount: A.overage_min_cents, recurring: { interval: 'week', usage_type: 'metered', meter: minMeter.id },
    product_data: { name: 'Ant Platform — Ann minute overage' }, metadata: { ann_meter: 'min' },
  });
  const text = await ensurePrice(stripe, 'ann_text_overage_wk', {
    unit_amount: A.overage_text_cents, recurring: { interval: 'week', usage_type: 'metered', meter: textMeter.id },
    product_data: { name: 'Ant Platform — Ann text overage' }, metadata: { ann_meter: 'text' },
  });
  return {
    base: base.id, min: min.id, text: text.id,
    minutes_meter: minMeter.id, texts_meter: textMeter.id,
    min_event: ANN_MIN_EVENT, text_event: ANN_TEXT_EVENT,
  };
}

// Resolve the 3 Ann price ids: prefer vaulted (STRIPE_PRICE_ANN_*), else the catalog.
async function annPriceIds(stripe) {
  const A = plans.ANN;
  const vBase = String((await getSecret(A.price_env_base)) || '').trim();
  const vMin = String((await getSecret(A.price_env_min_overage)) || '').trim();
  const vText = String((await getSecret(A.price_env_text_overage)) || '').trim();
  if (vBase && vMin && vText) return { base: vBase, min: vMin, text: vText };
  const cat = await ensureAnnCatalog(stripe);
  return { base: vBase || cat.base, min: vMin || cat.min, text: vText || cat.text };
}

// Ensure a tenant has the Ann subscription (base + 2 meter-backed metered prices). Idempotent
// via company.settings.phone.ann.subscription_id. Usage is reported by meter event (customer-
// scoped), so no per-item ids are needed. Returns { subscription_id } or { error }.
async function ensureAnnSubscription(pf, stripe, company) {
  const phone = (company.settings && company.settings.phone) || {};
  if (phone.ann && phone.ann.subscription_id) return phone.ann;
  const customerId = company.stripe_customer_id;
  if (!customerId) return { error: 'no_stripe_customer' };
  const ids = await annPriceIds(stripe);
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: ids.base }, { price: ids.min }, { price: ids.text }],
    collection_method: 'charge_automatically',
    metadata: { company_id: company.id, ann: '1' },
  });
  const ann = { subscription_id: sub.id, created_at: Date.now() };
  const nextSettings = Object.assign({}, company.settings, { phone: Object.assign({}, phone, { ann }) });
  await pf.patch('company', `id=eq.${encodeURIComponent(company.id)}`, { settings: nextSettings, updated_at: new Date().toISOString() });
  return ann;
}

// Report one week's overage as a meter event on the tenant's customer. identifier dedups a
// re-run of the same week so usage can't double-count.
async function reportAnnUsage(stripe, eventName, customerId, value, identifier, tsUnix) {
  return stripe.billing.meterEvents.create({
    event_name: eventName,
    identifier: identifier,
    timestamp: tsUnix,
    payload: { stripe_customer_id: customerId, value: String(Math.max(0, Math.round(value))) },
  });
}

module.exports.ANN_MIN_EVENT = ANN_MIN_EVENT;
module.exports.ANN_TEXT_EVENT = ANN_TEXT_EVENT;
module.exports.ensureAnnCatalog = ensureAnnCatalog;
module.exports.ensureMonthlyCatalog = ensureMonthlyCatalog;
module.exports.annPriceIds = annPriceIds;
module.exports.ensureAnnSubscription = ensureAnnSubscription;
module.exports.reportAnnUsage = reportAnnUsage;
module.exports.stripeKey = stripeKey;
