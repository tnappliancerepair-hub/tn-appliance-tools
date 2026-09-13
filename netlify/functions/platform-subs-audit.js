// platform-subs-audit — admin-only read + cancel of platform Stripe SUBSCRIPTIONS.
// Answers "any pending charges / trialing test shops?" and cleans them up. There's no
// subscription list/cancel action in platform-billing, so this is the hygiene tool for
// every test signup (Alyse's walk-through, throwaway shops, etc.).
//
//   ?secret=<admin>&action=list                      -> every subscription (status/email/slug/trial_end)
//   ?secret=<admin>&action=cancel&sub=<sub_id>&confirm=yes
//   ?secret=<admin>&action=cancel&email=<owner_email>&confirm=yes   (cancels that customer's sub[s])
//   ?secret=<admin>&action=audit                     -> per-sub: does it map to a company row? + is the webhook registered?
//   ?secret=<admin>&action=link&sub=<sub_id>&confirm=yes            (write the Stripe link onto that company row)
//
// Reuses platform-billing.stripeKey() (the LIVE platform Stripe key) + the stripe SDK.
'use strict';

const { getSecret } = require('./_lib/secrets');
const billing = require('./platform-billing');
const { platform } = require('./_lib/platform-rest');
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
    customer: (cust && cust.id) || (typeof s.customer === 'string' ? s.customer : null),
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

    // ── audit: is each live subscription actually WIRED to a company row? ─────────────
    // The webhook maps a subscription to a shop by metadata.company_id, then stripe_customer_id,
    // then stripe_subscription_id. If all three are blank the event logs no_company_match and
    // silently no-ops — so a first charge, a card failure, or a cancellation never reaches the
    // platform. This says, per subscription, whether that link exists. (2026-09-13)
    if (action === 'audit' || action === 'link') {
      const pf = await platform();
      if (!pf) return J(200, { ok: false, error: 'platform_not_configured' });
      const live = all.filter(function (s2) { return s2.status !== 'canceled' && s2.status !== 'incomplete_expired'; });
      const comps = await pf.get('company?select=id,slug,name,stripe_customer_id,stripe_subscription_id,billing_status,status');
      const bySub = {}, byCust = {}, bySlug = {};
      (comps || []).forEach(function (c) {
        if (c.stripe_subscription_id) bySub[c.stripe_subscription_id] = c;
        if (c.stripe_customer_id) byCust[c.stripe_customer_id] = c;
        if (c.slug) bySlug[c.slug] = c;
      });
      function assess(s2) {
        const m = s2.metadata || {};
        const custId = (s2.customer && s2.customer.id) || (typeof s2.customer === 'string' ? s2.customer : null);
        const byMeta = m.company_id ? (comps || []).find(function (c) { return c.id === m.company_id; }) : null;
        const matched = byMeta || bySub[s2.id] || (custId && byCust[custId]) || null;
        const slugComp = m.slug ? bySlug[m.slug] : null;
        return {
          id: s2.id, status: s2.status, slug: m.slug || null, customer: custId,
          trial_end: iso(s2.trial_end),
          linked: !!matched,
          linked_via: byMeta ? 'metadata.company_id' : (bySub[s2.id] ? 'stripe_subscription_id' : (custId && byCust[custId] ? 'stripe_customer_id' : null)),
          company_id: matched ? matched.id : null,
          // A shop exists under this slug but nothing ties the two together -> repairable.
          repairable_company_id: (!matched && slugComp) ? slugComp.id : null,
          orphan: !matched && !slugComp,          // paying, but no shop on the platform at all
        };
      }
      const assessed = live.map(assess);

      if (action === 'audit') {
        // Is the lifecycle webhook even registered? A perfect link is still dark without it.
        let hooks = [];
        try {
          const wl = await stripe.webhookEndpoints.list({ limit: 20 });
          hooks = (wl.data || [])
            .filter(function (w) { return /platform-stripe-webhook/.test(String(w.url || '')); })
            .map(function (w) { return { url: w.url, status: w.status, events: w.enabled_events }; });
        } catch (e) { hooks = [{ error: String((e && e.message) || e).slice(0, 160) }]; }
        return J(200, {
          ok: true,
          key_mode: /sk_live_/.test(key) ? 'live' : 'test',
          webhook_registered: hooks.length > 0 && !hooks[0].error,
          webhooks: hooks,
          live_subscriptions: assessed.length,
          linked: assessed.filter(function (a) { return a.linked; }).length,
          unlinked: assessed.filter(function (a) { return !a.linked; }).length,
          orphans: assessed.filter(function (a) { return a.orphan; }).length,
          subscriptions: assessed,
        });
      }

      // ── link: write the Stripe link onto the company row this sub belongs to ──────────
      const subId = String(q.sub || '').trim();
      if (!subId) return J(200, { ok: false, error: 'need &sub=<sub_id>' });
      const a = assessed.find(function (x) { return x.id === subId; });
      if (!a) return J(200, { ok: false, error: 'no live subscription with that id', hint: 'run action=audit' });
      if (a.linked) return J(200, { ok: true, already_linked: true, company_id: a.company_id, via: a.linked_via });
      const target = a.repairable_company_id;
      if (!target) return J(200, { ok: false, error: 'no company matches this subscription slug', slug: a.slug, note: 'orphan subscription — cancel it or provision the shop' });
      if (String(q.confirm || '') !== 'yes') {
        return J(200, { ok: true, would_link: { sub: subId, customer: a.customer, company_id: target, slug: a.slug }, note: 'add &confirm=yes to write' });
      }
      const patch = {};
      if (a.customer) patch.stripe_customer_id = a.customer;
      patch.stripe_subscription_id = subId;
      // patch(table, filter, cols) — THREE args. The two-arg form sends the object as the FILTER
      // and PATCHes the whole table. (documented footgun)
      const rowsPatched = await pf.patch('company', 'id=eq.' + encodeURIComponent(target), patch);
      const okPatch = Array.isArray(rowsPatched) && rowsPatched.length === 1;
      // Stamp company_id into the subscription metadata too, so the webhook maps on the FIRST
      // lookup even if the row is ever rewritten.
      let stamped = false;
      try { await stripe.subscriptions.update(subId, { metadata: Object.assign({}, (live.find(function (x) { return x.id === subId; }) || {}).metadata || {}, { company_id: target }) }); stamped = true; } catch (_) {}
      return J(200, { ok: !!okPatch, linked: { sub: subId, customer: a.customer, company_id: target, slug: a.slug }, metadata_stamped: stamped });
    }

    return J(200, { ok: false, error: 'unknown action; use list | audit | link | cancel' });
  } catch (e) {
    return J(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
