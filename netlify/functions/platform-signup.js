// platform-signup — PUBLIC self-serve, provision-on-payment. A shop picks a plan on
// signup.html; this sends them straight to Stripe Checkout, which REQUIRES A CARD. No tenant
// is created here — platform-stripe-webhook stands up the shop only after checkout completes
// (card entered). So a scammer who never enters a card never gets a tenant. The admin secret
// and service key stay server-side; the browser only ever gets the checkout link.
//
//   POST { name, email, trade?, plan:'office', addons:['own_area'], owner_name?, phone? }
//     -> { ok, checkout_url }
'use strict';

const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const plans = require('../../platform/plans.js');
const billing = require('./platform-billing');

function J(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'shop';
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return J(405, { ok: false, error: 'POST only' });
  let b = {};
  try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) {}

  // Kill switch — public endpoint. Stays closed until the owner opens signups
  // (vault PLATFORM_SIGNUP_LIVE=true). Admin secret bypasses so the flow can be tested.
  const live = String((await getSecret('PLATFORM_SIGNUP_LIVE')) || '').toLowerCase() === 'true';
  const adminBypass = (b.secret && b.secret === ((await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5'));
  if (!live && !adminBypass) {
    return J(200, { ok: false, error: 'signup_not_open', message: "We're onboarding shops by invite right now — leave your email and we'll reach out." });
  }

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const trade = String(b.trade || 'appliance').trim().toLowerCase();
  const planKey = String(b.plan || '').trim().toLowerCase();
  const addons = [].concat(b.addons || []).map(function (s) { return String(s).toLowerCase().trim(); }).filter(Boolean);

  if (!name) return J(400, { ok: false, error: 'shop name required' });
  if (!EMAIL_RE.test(email)) return J(400, { ok: false, error: 'a valid email is required' });
  if (!plans.PLANS.some(function (p) { return p.key === planKey; })) {
    return J(400, { ok: false, error: 'pick a plan', plans: plans.PLANS.map(function (p) { return p.key; }) });
  }

  const pf = await platform();
  if (!pf) return J(200, { ok: false, error: 'platform_not_configured' });

  // Reserve a unique slug now (so the webhook never attaches a paid signup onto an existing
  // shop). We don't create anything yet — just pick a free slug and stash it in checkout meta.
  let slug = slugify(name);
  for (let i = 0; i < 6; i++) {
    const ex = await pf.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    if (!ex || !ex.length) break;
    slug = slugify(name) + '-' + Math.random().toString(36).slice(2, 5);
  }

  // Card-required Checkout. Tenant is provisioned by the webhook after the card clears.
  let out;
  try {
    out = await billing.signupCheckout({ name, slug, trade, plan: planKey, addons, email, owner_name: b.owner_name || '', phone: b.phone || '', want_ann: !!b.want_ann, ref: String(b.ref || '').slice(0, 60) });
  } catch (e) {
    return J(200, { ok: false, error: 'checkout_failed', detail: String((e && e.message) || e).slice(0, 160) });
  }
  if (!out.ok || !out.url) {
    return J(200, { ok: false, error: out.error || 'checkout_unavailable',
      note: out.error === 'stripe_not_configured' ? 'set PLATFORM_STRIPE_SECRET_KEY or STRIPE_SECRET_KEY to enable billing' : undefined });
  }
  return J(200, { ok: true, checkout_url: out.url, session_id: out.session_id, plan: planKey, addons, slug });
};
