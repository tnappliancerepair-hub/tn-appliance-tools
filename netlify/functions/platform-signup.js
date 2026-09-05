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

// COMP path (no card): the founder / a comped shop walks the same signup form but provisions
// straight to a live tenant with NO Stripe — lands the owner in their own dashboard. Reuses the
// proven platform-provision (action=provision) + magiclink. Gated by PLATFORM_COMP_TOKEN (a
// low-privilege, shareable "free-setup" token — the admin secret also works for the founder's
// own walk). Never charges, never self-attributes a referral.
async function provisionComp(pf, o) {
  const SITE = billing.safeOrigin(o.origin);   // keep the comp walk on the domain it started on
  const provision = require('./platform-provision');
  const pev = { queryStringParameters: {
    secret: o.admin, action: 'provision', slug: o.slug, name: o.name, trade: o.trade,
    plan: o.plan, owner_email: o.email, owner_name: o.owner_name || '', owner_phone: o.phone || '',
    area: o.area || '', ref: '',   // a comp never attributes a referral (no self-crediting)
  } };
  let pd = {};
  try { pd = JSON.parse((await provision.handler(pev)).body || '{}'); } catch (e) { pd = { ok: false, error: String((e && e.message) || e) }; }
  if (!pd.ok || !pd.company) return J(200, { ok: false, error: 'provision_failed', detail: String((pd && pd.error) || '').slice(0, 200) });
  const companyId = pd.company.id;
  // Stamp comp + (if ticked) the "turn on Ann" onboarding flag — merge, never clobber settings.
  try {
    const rows = await pf.get(`company?id=eq.${encodeURIComponent(companyId)}&select=settings`);
    const s = (rows && rows[0] && rows[0].settings) || {};
    const termsRec = o.terms_version ? { terms: { accepted: true, version: o.terms_version, at: o.terms_at || new Date().toISOString(), via: 'comp' } } : {};
    const next = Object.assign({}, s, { comp: true }, termsRec, o.want_ann ? { ai: Object.assign({}, s.ai, { phone_requested: true }) } : {});
    await pf.patch('company', `id=eq.${encodeURIComponent(companyId)}`, { settings: next, status: 'active' });
  } catch (_) {}
  // One-tap login link → land straight in the owner's dashboard (setup home).
  let link = '';
  try {
    const mev = { queryStringParameters: { secret: o.admin, action: 'magiclink', email: o.email, redirect: `${SITE}/platform/onboard.html` } };
    const md = JSON.parse((await provision.handler(mev)).body || '{}');
    link = md.login_link || '';
  } catch (_) {}
  return J(200, { ok: true, comp: true, slug: o.slug, company_id: companyId, login_url: link || null,
    temp_password: (pd.login && pd.login.temp_password) || null,
    message: link ? 'Setting up your shop — taking you to your dashboard…' : 'Your shop is set up. Check your email for a sign-in link.' });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return J(405, { ok: false, error: 'POST only' });
  let b = {};
  try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) {}

  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const compToken = String((await getSecret('PLATFORM_COMP_TOKEN')) || '');
  const wantComp = b.comp === true || b.comp === 1 || b.comp === '1';
  // Comp is authorized ONLY by a matching dedicated PLATFORM_COMP_TOKEN — a low-privilege
  // "free-setup" token. The master admin secret is NEVER accepted as comp auth: comp arrives via
  // the signup.html URL, which loads the Meta Pixel, so a token here can reach Facebook — it must
  // be low-blast-radius (worst case: a free trial shop), never the platform's admin key. Comp is
  // disabled until a PLATFORM_COMP_TOKEN is vaulted.
  const compAuthed = wantComp && !!compToken && b.comp_token === compToken;

  // Kill switch — public endpoint. Stays closed until the owner opens signups
  // (vault PLATFORM_SIGNUP_LIVE=true). Admin secret + an authorized comp both bypass it.
  const live = String((await getSecret('PLATFORM_SIGNUP_LIVE')) || '').toLowerCase() === 'true';
  const adminBypass = (b.secret && b.secret === admin);
  if (!live && !adminBypass && !compAuthed) {
    return J(200, { ok: false, error: 'signup_not_open', message: "We're onboarding shops by invite right now — leave your email and we'll reach out." });
  }

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const trade = String(b.trade || 'appliance').trim().toLowerCase();
  const planKey = String(b.plan || '').trim().toLowerCase();
  const addons = [].concat(b.addons || []).map(function (s) { return String(s).toLowerCase().trim(); }).filter(Boolean);

  // Merchant Agreement acceptance — recorded on the shop for a durable audit (who accepted what
  // version, when). Required for every real signup (comp + card); an admin test-bypass may skip.
  const termsAccepted = b.terms_accepted === true || b.terms_accepted === 1 || b.terms_accepted === '1';
  const termsVersion = String(b.terms_version || '').slice(0, 40);
  const termsAt = new Date().toISOString();

  if (!name) return J(400, { ok: false, error: 'shop name required' });
  if (!EMAIL_RE.test(email)) return J(400, { ok: false, error: 'a valid email is required' });
  if (!termsAccepted && !adminBypass) {
    return J(400, { ok: false, error: 'terms_required', message: 'Please accept the Merchant Agreement to continue.' });
  }
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

  // COMP (no card): provision straight to a live tenant, skip Stripe entirely.
  if (wantComp) {
    if (!compAuthed) return J(200, { ok: false, error: 'comp_not_authorized', message: "This free-setup link isn't valid — check the link and try again." });
    return await provisionComp(pf, { name, slug, trade, plan: planKey, email, owner_name: b.owner_name || '', phone: b.phone || '', area: b.area || '', want_ann: !!b.want_ann, admin, terms_version: termsVersion, terms_at: termsAt, origin: String(b.origin || '') });
  }

  // Card-required Checkout. Tenant is provisioned by the webhook after the card clears.
  let out;
  try {
    out = await billing.signupCheckout({ name, slug, trade, plan: planKey, addons, email, owner_name: b.owner_name || '', phone: b.phone || '', want_ann: !!b.want_ann, ref: String(b.ref || '').slice(0, 60), terms_version: termsVersion, terms_accepted_at: termsAt, origin: String(b.origin || '') });
  } catch (e) {
    return J(200, { ok: false, error: 'checkout_failed', detail: String((e && e.message) || e).slice(0, 160) });
  }
  if (!out.ok || !out.url) {
    return J(200, { ok: false, error: out.error || 'checkout_unavailable',
      note: out.error === 'stripe_not_configured' ? 'set PLATFORM_STRIPE_SECRET_KEY or STRIPE_SECRET_KEY to enable billing' : undefined });
  }
  return J(200, { ok: true, checkout_url: out.url, session_id: out.session_id, plan: planKey, addons, slug });
};
