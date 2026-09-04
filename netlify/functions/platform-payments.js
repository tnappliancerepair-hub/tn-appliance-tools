// platform-payments — customer card payments via Stripe Connect (Express). The shop connects
// its OWN Stripe account; a customer pays the exact invoice by card; the money lands in the
// SHOP's account (the platform never holds funds), and the invoice auto-marks paid on return.
//
// Owner (session-token) actions:
//   POST ?do=connect_start   { access_token }            -> { ok, url }   (Stripe onboarding link)
//   POST ?do=connect_status  { access_token }            -> { ok, enabled, needs_onboarding }
// Customer (portal-token) actions:
//   POST ?do=pay    { t, job? }                          -> { ok, url }   (Stripe Checkout on the shop)
//   POST ?do=verify { t, session }                       -> { ok, paid }  (mark invoice paid on return)
// Admin:
//   POST ?do=diag&secret=<admin> [&probe=1]              -> { ok, key_mode, connect_ok }
//
// Money model: a DIRECT charge on the shop's connected account — funds go straight to the shop.
// An optional platform fee (company.settings.pay.platform_fee_bps) can be taken; default 0.
'use strict';

const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const SITE = 'https://tnapplianceexchange.net';
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

async function stripeKey() { return (await getSecret('PLATFORM_STRIPE_SECRET_KEY')) || (await getSecret('STRIPE_SECRET_KEY')) || ''; }
function keyMode(k) { return /^sk_live_|^rk_live_/.test(k) ? 'live' : (/^sk_test_|^rk_test_/.test(k) ? 'test' : 'unknown'); }

async function cfg() {
  const url = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url, key };
}
function db(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : []; },
    async patch(path, row) { const r = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); return r.ok; },
    async insert(table, row) { try { await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); } catch (_) {} },
  };
}
// owner session -> their company (role=owner)
async function ownerCompany(base, key, token) {
  if (!token) return null;
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: PLATFORM_ANON, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json(); if (!u || !u.id) return null;
    const rows = await db(base, key).get(`app_user?auth_user_id=eq.${encodeURIComponent(u.id)}&role=eq.owner&select=company_id,email&limit=1`);
    return (rows && rows[0]) ? rows[0] : null;
  } catch (_) { return null; }
}
// portal token -> { company, customer, job }
async function grantCtx(d, token) {
  const g = (await d.get(`portal_grant?token=eq.${encodeURIComponent(token)}&revoked=eq.false&select=company_id,customer_id,job_id&limit=1`))[0];
  if (!g) return null;
  let job = null;
  if (g.job_id) { job = (await d.get(`job?id=eq.${g.job_id}&select=id,company_id,customer_id&limit=1`))[0]; }
  if (!job) { job = (await d.get(`job?company_id=eq.${g.company_id}&customer_id=eq.${g.customer_id}&status=not.in.(canceled)&order=created_at.desc&select=id,company_id,customer_id&limit=1`))[0]; }
  return { g, job };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) {}
  const doo = String(q.do || p.do || '');

  const key = await stripeKey();
  if (!key) return json(200, { ok: false, error: 'stripe_not_configured', note: 'set PLATFORM_STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY)' });
  const stripe = new Stripe(key);
  const { url, key: svc } = await cfg();
  if (!url || !svc) return json(200, { ok: false, error: 'platform_not_configured' });
  const d = db(url, svc);

  try {
    // ── admin diag: mode + optional Connect probe (no secret ever returned) ───────────
    if (doo === 'diag') {
      const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
      if (q.secret !== admin) return json(403, { ok: false, error: 'forbidden' });
      const out = { ok: true, key_present: true, key_mode: keyMode(key), connect_ok: null };
      if (q.probe === '1') {
        try { const a = await stripe.accounts.create({ type: 'express', metadata: { probe: '1' } }); out.connect_ok = true; try { await stripe.accounts.del(a.id); } catch (_) {} }
        catch (e) { out.connect_ok = false; out.connect_error = String(e && e.message || e).slice(0, 200); }
      }
      return json(200, out);
    }

    // ── owner: start Connect onboarding ───────────────────────────────────────────────
    if (doo === 'connect_start') {
      const owner = await ownerCompany(url, svc, String(p.access_token || q.access_token || ''));
      if (!owner) return json(200, { ok: false, error: 'sign in as the shop owner' });
      const co = (await d.get(`company?id=eq.${owner.company_id}&select=id,name,stripe_connect_id,billing_email&limit=1`))[0];
      if (!co) return json(200, { ok: false, error: 'company not found' });
      let acct = co.stripe_connect_id;
      if (!acct) {
        // Risk buffer: put a payout DELAY on a brand-new connected account so a chargeback has time
        // to land while funds are still in the shop's Stripe balance (absorbed there, before it can
        // ever become a negative-balance/platform-backstop situation). Default 7 days; tune via vault
        // PLATFORM_NEW_SHOP_PAYOUT_DELAY_DAYS (2–30). Relax per shop later once it's proven.
        let delayDays = 7;
        try { const dv = parseInt(String((await getSecret('PLATFORM_NEW_SHOP_PAYOUT_DELAY_DAYS')) || ''), 10); if (Number.isFinite(dv) && dv >= 2 && dv <= 30) delayDays = dv; } catch (_) {}
        const a = await stripe.accounts.create({
          type: 'express',
          email: co.billing_email || owner.email || undefined,
          business_profile: { name: co.name || undefined },
          settings: { payouts: { schedule: { interval: 'daily', delay_days: delayDays } } },
          metadata: { company_id: co.id },
        });
        acct = a.id;
        await d.patch(`company?id=eq.${co.id}`, { stripe_connect_id: acct });
      }
      const link = await stripe.accountLinks.create({
        account: acct,
        refresh_url: `${SITE}/platform/owner.html?connect=refresh`,
        return_url: `${SITE}/platform/owner.html?connect=done`,
        type: 'account_onboarding',
      });
      return json(200, { ok: true, url: link.url, account: acct });
    }

    // ── owner: check onboarding status, flip payments_enabled ──────────────────────────
    if (doo === 'connect_status') {
      const owner = await ownerCompany(url, svc, String(p.access_token || q.access_token || ''));
      if (!owner) return json(200, { ok: false, error: 'sign in as the shop owner' });
      const co = (await d.get(`company?id=eq.${owner.company_id}&select=id,stripe_connect_id,payments_enabled&limit=1`))[0];
      if (!co) return json(200, { ok: false, error: 'company not found' });
      if (!co.stripe_connect_id) return json(200, { ok: true, connected: false, enabled: false, needs_onboarding: true });
      const a = await stripe.accounts.retrieve(co.stripe_connect_id);
      const enabled = !!(a && a.charges_enabled);
      if (enabled !== !!co.payments_enabled) await d.patch(`company?id=eq.${co.id}`, { payments_enabled: enabled });
      return json(200, { ok: true, connected: true, enabled, needs_onboarding: !enabled });
    }

    // ── customer: pay the invoice by card (Checkout on the shop's connected account) ────
    if (doo === 'pay') {
      const token = String(p.t || q.t || '').trim();
      const ctx = token ? await grantCtx(d, token) : null;
      if (!ctx || !ctx.job) return json(200, { ok: false, error: 'no active job' });
      const co = (await d.get(`company?id=eq.${ctx.g.company_id}&select=id,name,stripe_connect_id,payments_enabled,settings&limit=1`))[0];
      if (!co || !co.stripe_connect_id || !co.payments_enabled) return json(200, { ok: false, error: 'card payments not set up for this shop' });
      const iv = (await d.get(`invoice?job_id=eq.${ctx.job.id}&order=created_at.desc&select=id,total_cents,collected_cents,status&limit=1`))[0];
      if (!iv) return json(200, { ok: false, error: 'no invoice yet' });
      const due = Math.max(0, (iv.total_cents || 0) - (iv.collected_cents || 0));
      if (iv.status === 'paid' || due <= 0) return json(200, { ok: false, error: 'already paid' });
      const feeBps = Math.max(0, Math.min(3000, parseInt((co.settings && co.settings.pay && co.settings.pay.platform_fee_bps) || 0, 10) || 0));
      const opts = { stripeAccount: co.stripe_connect_id };
      const meta = { invoice_id: iv.id, job_id: ctx.job.id, company_id: co.id, kind: 'invoice_payment' };
      const params = {
        mode: 'payment',
        line_items: [{ price_data: { currency: 'usd', unit_amount: due, product_data: { name: (co.name || 'Repair') + ' — invoice' } }, quantity: 1 }],
        success_url: `${SITE}/platform/portal.html?t=${encodeURIComponent(token)}&paid=1&sess={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE}/platform/portal.html?t=${encodeURIComponent(token)}`,
        metadata: meta,
        payment_intent_data: { metadata: meta },
      };
      if (feeBps > 0) params.payment_intent_data.application_fee_amount = Math.round(due * feeBps / 10000);
      const session = await stripe.checkout.sessions.create(params, opts);
      return json(200, { ok: true, url: session.url });
    }

    // ── customer: verify on return, mark the invoice paid (idempotent) ─────────────────
    if (doo === 'verify') {
      const token = String(p.t || q.t || '').trim();
      const sessionId = String(p.session || q.session || '').trim();
      if (!token || !sessionId) return json(200, { ok: false, error: 'need t and session' });
      const ctx = token ? await grantCtx(d, token) : null;
      if (!ctx) return json(200, { ok: false, error: 'link expired' });
      const co = (await d.get(`company?id=eq.${ctx.g.company_id}&select=id,name,stripe_connect_id&limit=1`))[0];
      if (!co || !co.stripe_connect_id) return json(200, { ok: false, error: 'not set up' });
      const session = await stripe.checkout.sessions.retrieve(sessionId, { stripeAccount: co.stripe_connect_id });
      const paid = session && session.payment_status === 'paid';
      const invId = session && session.metadata && session.metadata.invoice_id;
      if (!paid || !invId) return json(200, { ok: true, paid: false });
      const iv = (await d.get(`invoice?id=eq.${invId}&company_id=eq.${co.id}&select=id,job_id,customer_id,total_cents,status,collected_cents&limit=1`))[0];
      if (!iv) return json(200, { ok: true, paid: false });
      if (iv.status !== 'paid') {
        await d.patch(`invoice?id=eq.${iv.id}`, { status: 'paid', paid_method: 'card', collected_cents: iv.total_cents, paid_at: new Date().toISOString(), paid_ref: sessionId });
        await d.insert('thread_message', { company_id: co.id, customer_id: iv.customer_id, job_id: iv.job_id, direction: 'in', channel: 'portal', sender: 'customer', body: '💳 Paid the invoice by card.' });
      }
      return json(200, { ok: true, paid: true });
    }

    return json(200, { ok: false, error: 'unknown do' });
  } catch (e) {
    return json(200, { ok: false, error: String(e && e.message || e).slice(0, 240) });
  }
};
