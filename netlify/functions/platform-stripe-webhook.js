// platform-stripe-webhook — the flip switch for the SaaS. When a shop's subscription is
// created / updated / canceled, this maps the subscription back to the company and flips
// company.plan / company.status / company.features automatically, so the surfaces show
// exactly what the shop pays for. OUR billing relationship with the shop; never touches the
// shop's own customer money.
//
// Stripe setup (owner, once): Developers -> Webhooks -> add endpoint
//   https://tnapplianceexchange.net/.netlify/functions/platform-stripe-webhook
//   events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
// Store its signing secret in the vault as PLATFORM_STRIPE_WEBHOOK_SECRET (whsec_...).
'use strict';

const Stripe = require('stripe');
const plans = require('../../platform/plans.js');
const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const { applyEntitlement } = require('./_lib/platform-features');

// Map a set of Stripe Price ids on the subscription -> which catalog module keys they are.
// Real Price ids resolve via the vaulted STRIPE_PRICE_* the catalog references; that mapping
// is built once per invocation. Ephemeral test prices (no vaulted id) fall back to the
// subscription's own metadata.plan / metadata.addons (set at checkout).
async function catalogPriceMap() {
  const map = {}; // stripe_price_id -> module key
  const all = plans.PLANS.concat(plans.ADDONS);
  for (const m of all) {
    if (!m.price_env) continue;
    const id = String((await getSecret(m.price_env)) || '').trim();
    if (id) map[id] = m.key;
  }
  return map;
}

function subStatusToCompanyStatus(s) {
  // Stripe sub status -> our company.status lifecycle
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete') return 'past_due';
  if (s === 'canceled' || s === 'incomplete_expired') return 'canceled';
  return 'active';
}

async function resolveEntitlement(sub, priceMap) {
  // Derive plan + add-on keys from the subscription's active items.
  const items = (sub.items && sub.items.data) || [];
  const keys = [];
  for (const it of items) {
    const pid = it.price && it.price.id;
    if (pid && priceMap[pid]) keys.push(priceMap[pid]);
  }
  // Fallback for ephemeral/test prices: read what checkout stamped on the sub metadata.
  if (!keys.length && sub.metadata) {
    if (sub.metadata.plan) keys.push(sub.metadata.plan);
    (String(sub.metadata.addons || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)).forEach(function (k) { keys.push(k); });
  }
  const planKeys = keys.filter(function (k) { return plans.PLANS.some(function (p) { return p.key === k; }); });
  const addonKeys = keys.filter(function (k) { return plans.ADDONS.some(function (a) { return a.key === k; }); });
  return { planKey: planKeys[0] || null, addons: addonKeys };
}

async function findCompanyId(pf, sub, session) {
  // Prefer explicit company_id metadata; else look up by stripe customer/subscription id.
  const meta = (sub && sub.metadata) || (session && session.metadata) || {};
  if (meta.company_id) return meta.company_id;
  const custId = (sub && sub.customer) || (session && session.customer);
  if (custId) {
    const rows = await pf.get(`company?stripe_customer_id=eq.${encodeURIComponent(custId)}&select=id&limit=1`);
    if (rows && rows[0]) return rows[0].id;
  }
  const subId = sub && sub.id;
  if (subId) {
    const rows = await pf.get(`company?stripe_subscription_id=eq.${encodeURIComponent(subId)}&select=id&limit=1`);
    if (rows && rows[0]) return rows[0].id;
  }
  return null;
}

const SITE = 'https://tnapplianceexchange.net';
const provision = require('./platform-provision');

// Stand up a tenant from the checkout metadata (called after the card clears), stamp the new
// company_id onto the Stripe subscription so later subscription.* events map, and email the
// owner a one-tap login link. Returns the new company_id (or null on failure).
async function provisionFromMeta(pf, stripe, sub, meta) {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const email = String(meta.email || '').trim().toLowerCase();
  const slug = String(meta.slug || '').trim();
  if (!slug || !email) return null;
  const pev = { queryStringParameters: {
    secret: admin, slug, name: meta.name || slug, trade: meta.trade || 'appliance',
    plan: meta.plan || 'office', owner_email: email, owner_name: meta.owner_name || '', owner_phone: meta.owner_phone || '',
  } };
  let pd = {};
  try { pd = JSON.parse((await provision.handler(pev)).body || '{}'); } catch (_) { pd = {}; }
  if (!pd.ok || !pd.company) { console.error('[platform-stripe-webhook] provision failed', pd && pd.error); return null; }
  const companyId = pd.company.id;
  // Stamp the subscription so subscription.updated/deleted map back to this company.
  try { await stripe.subscriptions.update(sub.id, { metadata: Object.assign({}, meta, { company_id: companyId }) }); } catch (_) {}
  // Email the owner a magic login link (best-effort; dry unless EMAIL_ENABLED).
  try {
    const mev = { queryStringParameters: { secret: admin, action: 'magiclink', email, redirect: `${SITE}/platform/owner.html` } };
    const md = JSON.parse((await provision.handler(mev)).body || '{}');
    const link = md.login_link || '';
    const shared = await getSecret('EMAIL_SHARED_SECRET');
    if (link && shared) {
      await fetch(`${SITE}/.netlify/functions/send-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': shared },
        body: JSON.stringify({ to: email, subject: 'Your Ant dashboard is ready',
          body: `Welcome to Ant, ${meta.name || slug}!\n\nYour shop is set up and your 14-day trial is running. Tap to sign in:\n${link}\n\nAny questions, just reply.` }),
        signal: AbortSignal.timeout(9000),
      });
    }
  } catch (_) {}
  return companyId;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const whSecret = await getSecret('PLATFORM_STRIPE_WEBHOOK_SECRET');
  // ONLY the dedicated platform key — never TN's live customer-payment STRIPE_SECRET_KEY.
  const key = (await getSecret('PLATFORM_STRIPE_SECRET_KEY')) || '';
  if (!whSecret || !key) {
    console.error('[platform-stripe-webhook] missing PLATFORM_STRIPE_WEBHOOK_SECRET or stripe key');
    return { statusCode: 500, body: JSON.stringify({ error: 'not configured' }) };
  }

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');

  let ev;
  try {
    ev = Stripe.webhooks.constructEvent(rawBody, sig, whSecret);
  } catch (err) {
    console.error('[platform-stripe-webhook] bad signature:', err.message);
    return { statusCode: 400, body: JSON.stringify({ error: 'bad signature' }) };
  }

  const handled = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.created', 'customer.subscription.deleted'];
  if (handled.indexOf(ev.type) === -1) {
    return { statusCode: 200, body: JSON.stringify({ ignored: true, type: ev.type }) };
  }

  try {
    const pf = await platform();
    if (!pf) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'platform_not_configured' }) };
    const stripe = new Stripe(key);
    const priceMap = await catalogPriceMap();

    let sub = null, session = null;
    if (ev.type === 'checkout.session.completed') {
      session = ev.data.object;
      if (session.mode !== 'subscription' || !session.subscription) {
        return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: 'not_subscription_checkout' }) };
      }
      sub = await stripe.subscriptions.retrieve(session.subscription);
    } else {
      sub = ev.data.object; // subscription.* events carry the subscription
    }

    let companyId = await findCompanyId(pf, sub, session);

    // PROVISION-ON-PAYMENT: a self-serve signup checkout completed and no tenant exists yet.
    // Stand up the shop now (card has cleared), then map the subscription to it.
    const meta = (sub && sub.metadata) || (session && session.metadata) || {};
    if (!companyId && ev.type === 'checkout.session.completed' && String(meta.company_provision) === '1') {
      companyId = await provisionFromMeta(pf, stripe, sub, meta);
    }

    if (!companyId) {
      console.error('[platform-stripe-webhook] no company match for', ev.type, sub && sub.id);
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no_company_match' }) };
    }

    const canceled = ev.type === 'customer.subscription.deleted' || sub.status === 'canceled';
    const ent = await resolveEntitlement(sub, priceMap);
    const compStatus = canceled ? 'churned' : subStatusToCompanyStatus(sub.status);
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

    const patch = {
      stripe_customer_id: sub.customer || undefined,
      stripe_subscription_id: sub.id || undefined,
      billing_status: sub.status || undefined,
      status: compStatus,
      current_period_end: periodEnd || undefined,
      trial_ends_at: trialEnd || undefined,
    };
    if (canceled) {
      // Keep the row + history; strip entitlements, mark churn. Do NOT delete data.
      patch.features = {};
      patch.churned_at = new Date().toISOString();
      patch.churn_reason = 'subscription_canceled';
      // Release the phone number + delete Ann so a churned shop stops costing us the ~$1/mo.
      try {
        const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
        await require('./platform-phone').handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'release', secret: admin, company_id: companyId }) });
      } catch (_) {}
    } else if (ent.planKey) {
      patch.plan = ent.planKey;
      patch.features = plans.featuresFor(ent.planKey, ent.addons);
    }

    const row = await applyEntitlement(companyId, patch);
    console.log('[platform-stripe-webhook]', ev.type, companyId, JSON.stringify({ plan: patch.plan, status: patch.status, canceled }));
    return { statusCode: 200, body: JSON.stringify({ ok: true, company_id: companyId, applied: !!row, plan: patch.plan || null, status: patch.status }) };
  } catch (e) {
    console.error('[platform-stripe-webhook] error:', e.message);
    // 200 so Stripe doesn't hammer retries on a transient; we log for follow-up.
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
