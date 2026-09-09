// platform-subs-audit — admin-only read + cancel of platform Stripe SUBSCRIPTIONS.
// Answers "any pending charges / trialing test shops?" and cleans them up. There's no
// subscription list/cancel action in platform-billing, so this is the hygiene tool for
// every test signup (Alyse's walk-through, throwaway shops, etc.).
//
//   ?secret=<admin>&action=list                      -> every subscription (status/email/slug/trial_end)
//   ?secret=<admin>&action=cancel&sub=<sub_id>&confirm=yes
//   ?secret=<admin>&action=cancel&email=<owner_email>&confirm=yes   (cancels that customer's sub[s])
//
// Reuses platform-billing.stripeKey() (the LIVE platform Stripe key) + the stripe SDK.
'use strict';

const { getSecret } = require('./_lib/secrets');
const billing = require('./platform-billing');
const Stripe = require('stripe');

exports.config = { timeout: 26 };

function J(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body, null, 2) };
}
function iso(unixSec) { return unixSec ? new Date(unixSec * 1000).toISOString() : null; }

function shape(s) {
  const cust = s.customer && typeof s.customer === 'object' ? s.customer : null;
  const m = s.metadata || {};
  return {
    id: s.id,
    status: s.status,                       // trialing | active | past_due | canceled | incomplete …
    created: iso(s.created),
    trial_end: iso(s.trial_end),
    current_period_end: iso(s.current_period_end),
    cancel_at_period_end: !!s.cancel_at_period_end,
    email: (cust && cust.email) || m.email || m.owner_email || null,
    slug: m.slug || null,
    plan: m.plan || null,
    name: m.name || m.shop_name || null,
  };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (String(q.secret || '') !== admin) return J(403, { ok: false, error: 'forbidden' });

  let key;
  try { key = await billing.stripeKey(); } catch (e) { key = null; }
  if (!key) return J(200, { ok: false, error: 'stripe_not_configured', note: 'PLATFORM_STRIPE_SECRET_KEY not set' });
  const stripe = new Stripe(key);
  const action = String(q.action || 'list').toLowerCase();

  try {
    // Pull all subscriptions (any status), customer expanded for the email.
    const all = [];
    let params = { status: 'all', limit: 100, expand: ['data.customer'] };
    for (let page = 0; page < 5; page++) {
      const res = await stripe.subscriptions.list(params);
      all.push(...res.data);
      if (!res.has_more) break;
      params = Object.assign({}, params, { starting_after: res.data[res.data.length - 1].id });
    }
    const rows = all.map(shape);

    if (action === 'list') {
      const active = rows.filter(function (r) { return r.status === 'trialing' || r.status === 'active' || r.status === 'past_due'; });
      return J(200, {
        ok: true,
        key_mode: /sk_live_/.test(key) ? 'live' : 'test',
        total: rows.length,
        billable_or_trialing: active.length,
        summary: rows.reduce(function (a, r) { a[r.status] = (a[r.status] || 0) + 1; return a; }, {}),
        subscriptions: rows,
      });
    }

    if (action === 'cancel') {
      const confirm = String(q.confirm || '') === 'yes';
      const subId = String(q.sub || '').trim();
      const email = String(q.email || '').trim().toLowerCase();
      let targets = [];
      if (subId) {
        targets = rows.filter(function (r) { return r.id === subId; });
      } else if (email) {
        targets = rows.filter(function (r) { return String(r.email || '').toLowerCase() === email && r.status !== 'canceled'; });
      } else {
        return J(200, { ok: false, error: 'need &sub=<sub_id> or &email=<owner_email>' });
      }
      if (!targets.length) return J(200, { ok: false, error: 'no matching subscription', hint: 'run action=list to see ids/emails' });
      if (!confirm) return J(200, { ok: true, would_cancel: targets.map(function (r) { return { id: r.id, status: r.status, email: r.email, slug: r.slug }; }), note: 'add &confirm=yes to cancel' });
      const done = [];
      for (const t of targets) {
        try { const c = await stripe.subscriptions.cancel(t.id); done.push({ id: t.id, status: c.status, email: t.email, slug: t.slug }); }
        catch (e) { done.push({ id: t.id, error: String((e && e.message) || e).slice(0, 160) }); }
      }
      return J(200, { ok: true, canceled: done });
    }

    return J(200, { ok: false, error: 'unknown action; use list | cancel' });
  } catch (e) {
    return J(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
