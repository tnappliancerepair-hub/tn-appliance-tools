// platform-referral — "The Ant Army": a paying shop refers OTHER shops and earns a $25/mo
// bill credit per active referred shop (4 = your $99 system runs free; past 4, cash per extra).
// A referring customer IS a partner row (migration 047 + 053), distinguished from a cash
// reseller by partner.company_id (their own shop). Attribution rides the SAME ?ref=<code> path
// resellers use (signup.html -> platform-signup -> stripe webhook validates + stamps
// company.referred_by), so a referred shop "just works".
//
// PHASE 1 (this file): earn + track + dashboard, NO Stripe change. The credit is displayed as
// "pending — applies to your next bill" until Phase 2 (do=apply, gated PLATFORM_REFERRAL_CREDIT_LIVE)
// writes the actual Stripe coupon.
//
//   POST ?do=ensure  { access_token }  -> idempotently create/get this shop's partner row
//                                          (code=slug, company_id=theirs, flat $25/mo lifetime)
//                                          -> { ok, link, code, active, free_at, credit_cents, cash_cents, to_free, shops }
//   POST ?do=status  { access_token }  -> same shape, read-only (assumes ensure has run)
'use strict';

const crypto = require('crypto');
const Stripe = require('stripe');
const OA = require('./_lib/owner-actions');           // resolveCaller (session -> company via platform_whoami) + MGMT + service-key db
const { getSecret } = require('./_lib/secrets');
const plans = require('../../platform/plans.js');

// Same key resolution as platform-billing.stripeKey (dedicated platform key, else TN's account).
async function stripeKey() { return (await getSecret('PLATFORM_STRIPE_SECRET_KEY')) || (await getSecret('STRIPE_SECRET_KEY')) || ''; }
async function creditLive() { return String((await getSecret('PLATFORM_REFERRAL_CREDIT_LIVE')) || '') === '1'; }

const SITE = 'https://tnapplianceexchange.net';
const CREDIT_PER_SHOP_CENTS = 2500;                   // $25/mo bill credit per active referred shop
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
exports.config = { timeout: 26 };

// The referring shop's OWN base-plan price → how many referrals make it free.
function planCents(co) {
  const p = plans.byKey(co && co.plan);
  return (p && p.price_cents) || 9900;                 // default Full Office $99
}
// Is a referred shop currently a live paying tenant (so it earns the credit)?
// Mirrors platform-partner.revenueActive: not terminal, not still in trial, has a real plan.
function revenueActive(co) {
  const s = String(co.status || '').toLowerCase();
  const b = String(co.billing_status || '').toLowerCase();
  if (['churned', 'canceled', 'cancelled', 'past_due', 'unpaid'].includes(s)) return false;
  if (s === 'trialing' || b === 'trialing') return false;
  const plan = String(co.plan || '').toLowerCase();
  if (!plan || plan === 'trial') return false;
  return true;
}

// Compute the credit/cash split from the referring shop's own plan + its referred companies.
function computeSplit(myCo, referred) {
  const cap = planCents(myCo);                          // credit can never exceed the referrer's own bill
  const freeAt = Math.max(1, Math.ceil(cap / CREDIT_PER_SHOP_CENTS));  // =4 at $99
  const shops = (referred || []).map(function (co) {
    const active = revenueActive(co);
    return { name: co.name, slug: co.slug, status: co.status || (active ? 'active' : 'pending'), active: active };
  });
  const active = shops.filter((s) => s.active).length;
  const credit = Math.min(Math.min(active, freeAt) * CREDIT_PER_SHOP_CENTS, cap);
  const cash = Math.max(0, active - freeAt) * CREDIT_PER_SHOP_CENTS;
  return { free_at: freeAt, active: active, credit_cents: credit, cash_cents: cash, to_free: Math.max(0, freeAt - active), shops: shops, plan_cents: cap };
}

// ---- Phase 2: apply the bill credit as a Stripe coupon on the referrer's subscription ----
// Pay-on-collection: credit = paying-active referred shops × $25, capped at the referrer's plan.
// Coupons are immutable on amount, so when the count changes we mint a fresh coupon + swap +
// delete the old one; when it drops to $0 we detach the discount. Idempotent (retrieve the
// existing coupon and no-op when the amount already matches). Stripe is null in dryrun/shadow.
async function ensureCoupon(stripe, partner, amountCents) {
  const oldId = partner.stripe_coupon_id || null;
  if (!amountCents) return { coupon_id: null, old_coupon_id: oldId, changed: !!oldId };
  if (oldId) {
    try {
      const c = await stripe.coupons.retrieve(oldId);
      if (c && !c.deleted && c.amount_off === amountCents && String(c.currency || 'usd') === 'usd') {
        return { coupon_id: oldId, old_coupon_id: null, changed: false };
      }
    } catch (_) { /* coupon gone -> fall through to create */ }
  }
  const c = await stripe.coupons.create({ amount_off: amountCents, currency: 'usd', duration: 'forever', name: 'Ant Army credit (' + partner.code + ')' });
  return { coupon_id: c.id, old_coupon_id: oldId, changed: true };
}

// Recompute + (optionally) apply one bill-credit referrer's coupon. Cash resellers are skipped
// (they get paid cash, not a bill discount). Returns a result object; writes nothing unless live.
async function applyOne(d, stripe, partner, opts) {
  opts = opts || {};
  const dryrun = !!opts.dryrun, live = !!opts.live;
  if (!partner.company_id) return { code: partner.code, skipped: 'cash_reseller' };
  if (partner.active === false) return { code: partner.code, skipped: 'inactive' };
  const meRows = await d.get(`company?id=eq.${partner.company_id}&select=id,name,plan,status,billing_status,stripe_subscription_id`);
  const me = meRows && meRows[0];
  if (!me) return { code: partner.code, skipped: 'no_company' };
  const referred = await d.get(`company?referred_by=eq.${encodeURIComponent(partner.code)}&select=status,billing_status,plan`);
  const split = computeSplit(me, referred || []);
  const desired = split.credit_cents;                    // already capped at the referrer's plan
  const out = { code: partner.code, company: me.name, active_referrals: split.active, credit_cents: desired, cash_cents: split.cash_cents, has_subscription: !!me.stripe_subscription_id };
  if (dryrun) return Object.assign(out, { mode: 'dryrun', applied: false });
  if (!live) return Object.assign(out, { mode: 'shadow', applied: false, note: 'PLATFORM_REFERRAL_CREDIT_LIVE not set — credit pending' });
  if (!me.stripe_subscription_id) return Object.assign(out, { mode: 'live', applied: false, note: 'no active subscription yet — credit pending' });
  let cur;
  try { cur = await ensureCoupon(stripe, partner, desired); }
  catch (e) { return Object.assign(out, { mode: 'live', applied: false, error: 'coupon: ' + String((e && e.message) || e).slice(0, 140) }); }
  try {
    if (desired > 0) {
      try { await stripe.subscriptions.update(me.stripe_subscription_id, { discounts: [{ coupon: cur.coupon_id }] }); }
      catch (e) { await stripe.subscriptions.update(me.stripe_subscription_id, { coupon: cur.coupon_id }); }   // older Stripe API
    } else {
      try { await stripe.subscriptions.deleteDiscount(me.stripe_subscription_id); } catch (_) {}
    }
  } catch (e) { return Object.assign(out, { mode: 'live', applied: false, error: 'attach: ' + String((e && e.message) || e).slice(0, 140) }); }
  if (cur.changed) {
    try { await d.patch(`partner?id=eq.${partner.id}`, { stripe_coupon_id: cur.coupon_id }); } catch (_) {}
    if (cur.old_coupon_id) { try { await stripe.coupons.del(cur.old_coupon_id); } catch (_) {} }
  }
  return Object.assign(out, { mode: 'live', applied: true, coupon_id: cur.coupon_id });
}

// Recompute the credit for the referrer of ONE code (called from the Stripe webhook when a
// referred shop pays / churns). Resolves the referred shop's referrer partner by its code.
async function applyReferrerByCode(refCode, opts) {
  opts = opts || {};
  const { base, key } = await OA.cfg();
  if (!base || !key) return { ok: false, error: 'not configured' };
  const d = OA.db(base, key);
  const partner = (await d.get(`partner?code=eq.${encodeURIComponent(refCode)}&limit=1`))[0];
  if (!partner) return { ok: false, error: 'no partner for code' };
  if (!partner.company_id) return { ok: true, skipped: 'cash_reseller' };
  const live = await creditLive();
  let stripe = null;
  if (live && !opts.dryrun) { const sk = await stripeKey(); if (sk) stripe = new Stripe(sk); }
  const res = await applyOne(d, stripe, partner, { dryrun: !!opts.dryrun, live });
  return Object.assign({ ok: true }, res);
}

// Sweep every bill-credit referrer (the daily cron backstop for anything the webhook missed).
async function applyAll(opts) {
  opts = opts || {};
  const { base, key } = await OA.cfg();
  if (!base || !key) return { ok: false, error: 'not configured' };
  const d = OA.db(base, key);
  const partners = await d.get('partner?company_id=not.is.null&active=is.true&select=id,code,company_id,active,stripe_coupon_id&limit=500');
  const live = await creditLive();
  let stripe = null;
  if (live && !opts.dryrun) { const sk = await stripeKey(); if (sk) stripe = new Stripe(sk); }
  const results = [];
  for (const pr of (partners || [])) {
    try { results.push(await applyOne(d, stripe, pr, { dryrun: !!opts.dryrun, live })); }
    catch (e) { results.push({ code: pr.code, error: String((e && e.message) || e).slice(0, 120) }); }
  }
  return { ok: true, live: live, dryrun: !!opts.dryrun, count: results.length, results: results };
}
exports.applyReferrerByCode = applyReferrerByCode;
exports.applyAll = applyAll;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const q = event.queryStringParameters || {};
  const doo = String(q.do || 'status').toLowerCase();
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }

  // do=apply — Phase 2 credit application. Admin/cron only (NOT owner-session): recompute + push
  // the Stripe coupon for one code (&code=) or all bill-credit referrers. ?dryrun=1 = zero writes;
  // real writes gated behind PLATFORM_REFERRAL_CREDIT_LIVE=1 (checked inside applyAll/applyOne).
  if (doo === 'apply') {
    const isCron = !!(p && p.next_run);                  // scheduled invocation self-authorizes
    if (!isCron) {
      const admin = (await getSecret('VAPI_ADMIN_SECRET')) || '';
      const secret = String(p.secret || q.secret || '').trim();
      if (!admin || secret !== admin) return json(403, { ok: false, error: 'admin only' });
    }
    const dryrun = String(q.dryrun || '') === '1' || !!p.dryrun;
    const code = String(q.code || p.code || '').trim();
    try {
      const r = code ? await applyReferrerByCode(code, { dryrun }) : await applyAll({ dryrun });
      return json(200, r);
    } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
  }

  const caller = await OA.resolveCaller(String(p.access_token || '').trim());
  if (caller.error) return json(caller.error === 'not signed in' ? 401 : 403, { ok: false, error: caller.error });
  if (!OA.MGMT.includes(caller.role)) return json(403, { ok: false, error: 'not allowed for your role' });
  const d = caller.d;                                   // service-key PostgREST client (owner-actions db())

  try {
    // The referring shop's own company row (slug drives the referral code; plan drives free-at).
    const meRows = await d.get(`company?id=eq.${caller.companyId}&select=slug,name,plan,features`);
    const me = meRows && meRows[0];
    if (!me) return json(200, { ok: false, error: 'no company' });
    const live = String((await getSecret('PLATFORM_REFERRAL_CREDIT_LIVE')) || '') === '1';

    // Find (or, on ensure, create) THIS shop's partner row — keyed by its own company_id.
    let mine = (await d.get(`partner?company_id=eq.${caller.companyId}&limit=1`))[0];

    if (doo === 'ensure' && !mine) {
      // Pick a code: prefer the slug; if some OTHER partner already holds it, suffix it.
      let code = me.slug;
      const clash = (await d.get(`partner?code=eq.${encodeURIComponent(code)}&limit=1`))[0];
      if (clash) code = `${me.slug}-${String(caller.companyId).slice(0, 4)}`;
      mine = await d.insert('partner', {
        code: code,
        company_id: caller.companyId,
        name: me.name || me.slug,
        commission_type: 'flat_per_account',
        commission_flat_cents: CREDIT_PER_SHOP_CENTS,
        commission_months: 0,                            // lifetime while the referred shop is active
        active: true,
        token: 'pt_' + crypto.randomBytes(16).toString('hex'),
        note: 'customer bill-credit referrer (Ant Army)',
      });
    }

    if (!mine) {
      // status called before ensure — report a zero state with the would-be link so the card still renders.
      const split0 = computeSplit(me, []);
      return json(200, Object.assign({ ok: true, code: me.slug, link: `${SITE}/platform/signup.html?ref=${encodeURIComponent(me.slug)}`, credit_live: live, ensured: false }, split0));
    }

    // Referred shops = every company stamped with this partner's code.
    const referred = await d.get(`company?referred_by=eq.${encodeURIComponent(mine.code)}&select=name,slug,status,billing_status,plan,referred_at&order=referred_at.asc`);
    const split = computeSplit(me, referred || []);
    return json(200, Object.assign({
      ok: true,
      code: mine.code,
      link: `${SITE}/platform/signup.html?ref=${encodeURIComponent(mine.code)}`,
      credit_live: live,                                 // Phase 2 flag: false => credit is "pending, applies next bill"
      ensured: doo === 'ensure',
    }, split));
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
