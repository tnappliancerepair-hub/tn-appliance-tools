// platform-partner — the reseller/referral engine for the AssistAnt platform. A PARTNER
// (e.g. TK) refers shops and earns a commission on the accounts they bring. Owner-only data
// (partner + partner_payout, migration 047) is reached ONLY through the SERVICE key here;
// a partner views their own pipeline through a read-only TOKEN (never a direct table read).
//
// Mirrors the tech_payout discipline (022): the ledger stores the PAID state; EARNED derives
// at read time from the referred companies' live plan/MRR.
//
//   ?do=upsert&secret=<admin>&code=TK&name=..&email=..&phone=..
//        &commission_type=sub_pct&commission_pct=20&commission_months=0   -> mints a dashboard token
//   ?do=list&secret=<admin>
//   ?do=report&secret=<admin>&code=TK           (admin)  — or —  ?do=report&token=<partner.token>  (partner, read-only)
//   ?do=record_payout&secret=<admin>&code=TK&amount=<cents>[&company=<slug>&period=..&note=..]
'use strict';
const crypto = require('crypto');
const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const plans = require('../../platform/plans.js');

const SITE = 'https://tnapplianceexchange.net';
const OPERATOR_EMAILS = ['tnappliancerepair@gmail.com'];
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
const MONTH_MS = 30.44 * 24 * 3600 * 1000;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function operatorFromJWT(event) {
  const h = event.headers || {};
  const m = String(h.authorization || h.Authorization || '').match(/Bearer\s+(.+)/i);
  if (!m) return null;
  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return OPERATOR_EMAILS.includes(String((u && u.email) || '').toLowerCase()) ? String(u.email).toLowerCase() : null;
  } catch (_) { return null; }
}

// A referred company's monthly recurring revenue, from its plan (+ any billed add-on).
function planMrrCents(co) {
  const p = plans.byKey(co.plan);
  let c = (p && p.price_cents) || 0;
  const f = co.features || {};
  if (f.exclusive_territory) { const a = plans.byKey('own_area'); if (a) c += a.price_cents; }
  return c;
}
// Is this account currently generating subscription revenue (so it earns the partner)?
function revenueActive(co) {
  const s = String(co.status || '').toLowerCase();
  const b = String(co.billing_status || '').toLowerCase();
  if (['churned', 'canceled', 'cancelled', 'past_due', 'unpaid'].includes(s)) return false;
  if (s === 'trialing' || b === 'trialing') return false;           // in trial → not paying yet
  const plan = String(co.plan || '').toLowerCase();
  if (!plan || plan === 'trial') return false;
  return true;
}
function monthsSince(iso) { if (!iso) return 0; const ms = Date.now() - Date.parse(iso); return ms > 0 ? Math.floor(ms / MONTH_MS) : 0; }

function computeReport(partner, companies, payouts) {
  const pct = Number(partner.commission_pct || 0);
  const flat = Number(partner.commission_flat_cents || 0);
  const type = partner.commission_type || 'sub_pct';
  const winMonths = Number(partner.commission_months || 0);   // 0 = lifetime while active
  const perMonthFor = (mrr) => (type === 'flat_per_account' ? flat : Math.round((pct / 100) * mrr));

  const accounts = companies.map(function (co) {
    const mrr = planMrrCents(co);
    const active = revenueActive(co);
    const monthsActive = monthsSince(co.referred_at);
    const inWindow = winMonths <= 0 ? true : monthsActive < winMonths;
    const perMonth = perMonthFor(mrr);
    const monthly = (active && inWindow) ? perMonth : 0;              // current run-rate for this account
    const eligible = winMonths <= 0 ? (monthsActive + 1) : Math.min(monthsActive + 1, winMonths);
    const earnedEst = active ? perMonth * Math.max(1, eligible) : 0;  // estimate over elapsed months
    return {
      slug: co.slug, name: co.name, plan: co.plan, trade: co.trade,
      status: co.status || (active ? 'active' : 'inactive'),
      mrr_cents: mrr, referred_at: co.referred_at, months_active: monthsActive,
      in_window: inWindow, monthly_commission_cents: monthly, earned_estimate_cents: earnedEst,
    };
  });

  const monthly_run_rate = accounts.reduce((s, a) => s + a.monthly_commission_cents, 0);
  const earned_estimate = accounts.reduce((s, a) => s + a.earned_estimate_cents, 0);
  const paid = payouts.reduce((s, p) => s + (p.amount_cents || 0), 0);
  return {
    partner: {
      code: partner.code, name: partner.name, email: partner.email, phone: partner.phone,
      commission_type: type, commission_pct: pct, commission_flat_cents: flat,
      commission_months: winMonths, active: partner.active,
    },
    referral_link: `${SITE}/platform/signup.html?ref=${encodeURIComponent(partner.code)}`,
    accounts,
    totals: {
      accounts: accounts.length,
      active_accounts: accounts.filter((a) => a.monthly_commission_cents > 0).length,
      monthly_run_rate_cents: monthly_run_rate,
      earned_estimate_cents: earned_estimate,
      paid_cents: paid,
      owed_estimate_cents: Math.max(0, earned_estimate - paid),
    },
    note: 'monthly_run_rate is the precise current rate; earned_estimate assumes each account was active for its elapsed months. Recorded payouts are the source of truth for what the partner has actually been paid.',
  };
}

async function buildReport(pf, partner) {
  const companies = await pf.get(`company?referred_by=eq.${encodeURIComponent(partner.code)}&select=id,slug,name,trade,plan,status,billing_status,features,referred_at&order=referred_at.asc`);
  const payouts = await pf.get(`partner_payout?partner_id=eq.${partner.id}&select=amount_cents`);
  return computeReport(partner, companies || [], payouts || []);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let body = {}; try { body = event.body ? JSON.parse(event.body) : {}; } catch (_) {}
  const g = (k) => (q[k] != null ? q[k] : body[k]);
  const doo = String(g('do') || '').toLowerCase();

  const pf = await platform();
  if (!pf) return json(200, { ok: false, error: 'platform_not_configured' });

  // Partner's own read-only view — token gate, no admin secret needed.
  const token = String(g('token') || '').trim();
  if (doo === 'report' && token) {
    const rows = await pf.get(`partner?token=eq.${encodeURIComponent(token)}&limit=1`);
    const partner = rows && rows[0];
    if (!partner) return json(200, { ok: false, error: 'bad_token' });
    return json(200, Object.assign({ ok: true, mode: 'partner' }, await buildReport(pf, partner)));
  }

  // Everything else is admin/operator only.
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const isAdmin = q.secret === guard || body.secret === guard || !!(await operatorFromJWT(event));
  if (!isAdmin) return json(403, { ok: false, error: 'forbidden' });

  try {
    if (doo === 'list') {
      const rows = await pf.get('partner?select=code,name,email,phone,commission_type,commission_pct,commission_flat_cents,commission_months,active,token,created_at&order=created_at.asc');
      return json(200, { ok: true, partners: rows || [] });
    }

    if (doo === 'upsert') {
      const code = String(g('code') || '').trim();
      if (!code) return json(200, { ok: false, error: 'need code' });
      const patch = {};
      const setIf = (k, v) => { if (v !== undefined && v !== null && v !== '') patch[k] = v; };
      setIf('name', g('name')); setIf('email', g('email')); setIf('phone', g('phone'));
      setIf('commission_type', g('commission_type')); setIf('note', g('note'));
      if (g('commission_pct') != null && g('commission_pct') !== '') patch.commission_pct = Number(g('commission_pct'));
      if (g('commission_flat_cents') != null && g('commission_flat_cents') !== '') patch.commission_flat_cents = parseInt(g('commission_flat_cents'), 10);
      if (g('commission_months') != null && g('commission_months') !== '') patch.commission_months = parseInt(g('commission_months'), 10);
      if (g('active') != null) patch.active = !(String(g('active')) === 'false' || String(g('active')) === '0');
      patch.updated_at = new Date().toISOString();

      const existing = await pf.get(`partner?code=eq.${encodeURIComponent(code)}&limit=1`);
      if (existing && existing[0]) {
        const up = await pf.patch('partner', `code=eq.${encodeURIComponent(code)}`, patch);
        const p = up[0];
        return json(200, { ok: true, updated: true, partner: p, dashboard: `${SITE}/platform/partner.html?token=${p.token}` });
      }
      patch.code = code;
      patch.token = 'pt_' + crypto.randomBytes(16).toString('hex');
      if (patch.active === undefined) patch.active = true;
      const ins = await pf.insert('partner', patch);
      return json(200, { ok: true, created: true, partner: ins, dashboard: `${SITE}/platform/partner.html?token=${ins.token}`, referral_link: `${SITE}/platform/signup.html?ref=${encodeURIComponent(code)}` });
    }

    if (doo === 'report') {
      const code = String(g('code') || '').trim();
      if (!code) return json(200, { ok: false, error: 'need code or token' });
      const rows = await pf.get(`partner?code=eq.${encodeURIComponent(code)}&limit=1`);
      const partner = rows && rows[0];
      if (!partner) return json(200, { ok: false, error: 'unknown partner' });
      return json(200, Object.assign({ ok: true, mode: 'admin', dashboard: `${SITE}/platform/partner.html?token=${partner.token}` }, await buildReport(pf, partner)));
    }

    if (doo === 'record_payout') {
      const code = String(g('code') || '').trim();
      const amount = Math.round(Number(g('amount') || g('amount_cents') || 0));
      if (!code || !amount) return json(200, { ok: false, error: 'need code + amount (cents)' });
      const rows = await pf.get(`partner?code=eq.${encodeURIComponent(code)}&select=id&limit=1`);
      const partner = rows && rows[0];
      if (!partner) return json(200, { ok: false, error: 'unknown partner' });
      const row = { partner_id: partner.id, amount_cents: amount, period: g('period') || null, note: g('note') || null };
      const slug = String(g('company') || '').trim();
      if (slug) { const cc = await pf.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`); if (cc && cc[0]) row.company_id = cc[0].id; }
      const ins = await pf.insert('partner_payout', row);
      return json(200, { ok: true, payout: ins });
    }

    return json(200, { ok: false, error: 'unknown do', actions: ['upsert', 'list', 'report', 'record_payout'] });
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};
