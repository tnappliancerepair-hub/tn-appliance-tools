// platform-signup — PUBLIC self-serve. A shop picks a plan on signup.html; this stands up
// their tenant (trial) server-side and hands back a Stripe Checkout URL. The admin secret and
// service key stay server-side — the browser only ever gets the checkout link. When they pay,
// platform-stripe-webhook flips them active + turns on the features their plan includes.
//
//   POST { name, email, trade?, plan:'office', addons:['own_area'], area?, owner_name?, phone? }
//     -> { ok, slug, company_id, checkout_url, login_email_sent }
//
// If Stripe isn't configured yet, still provisions the trial tenant and returns checkout_url:null
// (so Teddy can watch the tenant appear before billing is turned on).
'use strict';

const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const plans = require('../../platform/plans.js');
const provision = require('./platform-provision');
const billing = require('./platform-billing');

const SITE = 'https://tnapplianceexchange.net';

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

  // Kill switch — a PUBLIC endpoint that provisions real tenants + Supabase logins. Stays
  // closed until the owner opens signups (vault PLATFORM_SIGNUP_LIVE=true). Admin secret
  // bypasses so the flow can be tested end-to-end before launch.
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
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';

  // Unique slug (never attach a new signup onto an existing shop's slug).
  let slug = slugify(name);
  for (let i = 0; i < 6; i++) {
    const ex = await pf.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    if (!ex || !ex.length) break;
    slug = slugify(name) + '-' + Math.random().toString(36).slice(2, 5);
  }

  // 1) Provision the tenant (login + company + owner link) via the internal handler — admin
  //    secret held server-side. Provision is idempotent by slug.
  const pev = { queryStringParameters: {
    secret: admin, slug, name, trade, plan: planKey,
    owner_email: email, owner_name: b.owner_name || '', owner_phone: b.phone || '', area: b.area || '',
  } };
  let pd = {};
  try { pd = JSON.parse((await provision.handler(pev)).body || '{}'); } catch (e) { pd = { ok: false, error: 'provision_parse' }; }
  if (!pd.ok || !pd.company) return J(200, { ok: false, step: 'provision', error: pd.error || 'provision_failed' });
  const companyId = pd.company.id;

  // Mark it a trial with a 14-day window + set features to the plan's set (so the board is
  // usable during the trial even before the first charge). Webhook re-confirms on payment.
  try {
    await pf.patch('company', `id=eq.${encodeURIComponent(companyId)}`, {
      status: 'trial',
      trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString(),
      features: plans.featuresFor(planKey, addons),
      billing_email: email,
      updated_at: new Date().toISOString(),
    });
  } catch (_) {}

  // 2) Stripe Checkout for the chosen modules (internal call; test-mode safe).
  let checkoutUrl = null, stripeNote = null;
  try {
    const bev = { httpMethod: 'POST', body: JSON.stringify({
      action: 'checkout', secret: admin, company_id: companyId, plan: planKey, addons, email, trial_days: 14,
    }) };
    const bd = JSON.parse((await billing.handler(bev)).body || '{}');
    if (bd.ok && bd.url) checkoutUrl = bd.url;
    else stripeNote = bd.error || 'checkout_unavailable';
  } catch (e) { stripeNote = String((e && e.message) || e).slice(0, 120); }

  // 3) Email the owner a one-tap magic login link (best-effort; dry unless EMAIL_ENABLED).
  let loginEmailSent = false;
  try {
    const mev = { queryStringParameters: { secret: admin, action: 'magiclink', email, redirect: `${SITE}/platform/owner.html` } };
    const md = JSON.parse((await provision.handler(mev)).body || '{}');
    const link = md.login_link || '';
    if (link) {
      const shared = await getSecret('EMAIL_SHARED_SECRET');
      if (shared) {
        const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': shared },
          body: JSON.stringify({
            to: email,
            subject: 'Your Ant dashboard is ready',
            body: `Welcome to Ant, ${name}!\n\nYour shop's dashboard is set up. Tap to sign in:\n${link}\n\nThis link logs you straight into your owner board. Any questions, just reply.`,
          }),
          signal: AbortSignal.timeout(9000),
        });
        loginEmailSent = r.ok;
      }
    }
  } catch (_) {}

  return J(200, {
    ok: true, slug, company_id: companyId,
    checkout_url: checkoutUrl, stripe_note: stripeNote,
    login_email_sent: loginEmailSent,
    plan: planKey, addons,
  });
};
