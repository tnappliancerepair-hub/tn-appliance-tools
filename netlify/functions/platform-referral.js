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
const OA = require('./_lib/owner-actions');           // resolveCaller (session -> company via platform_whoami) + MGMT + service-key db
const { getSecret } = require('./_lib/secrets');
const plans = require('../../platform/plans.js');

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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const q = event.queryStringParameters || {};
  const doo = String(q.do || 'status').toLowerCase();
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }

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
