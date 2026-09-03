// platform-signup-verify — provision-on-redirect for the CARD signup. After a shop pays at
// Stripe Checkout they're bounced back to signup.html?billing=success&session_id=... This reads
// that session DIRECTLY (with the same key checkout charged on) and stands up the tenant on the
// spot — NO webhook signing-secret dependency (the same verify-on-redirect pattern the customer
// card payments use). The webhook stays as the lifecycle backstop for later subscription.* events.
//   POST { session_id }  ->  { ok, login_url, slug }   (or { ok:false, error })
'use strict';

const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const billing = require('./platform-billing');
const webhook = require('./platform-stripe-webhook');
const provision = require('./platform-provision');

const SITE = 'https://tnapplianceexchange.net';
function J(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  let b = {}; try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) {}
  const q = event.queryStringParameters || {};
  const sessionId = String(b.session_id || q.session_id || '').trim();
  if (!/^cs_/.test(sessionId)) return J(200, { ok: false, error: 'bad_session' });

  const key = await billing.stripeKey();
  if (!key) return J(200, { ok: false, error: 'stripe_not_configured' });
  const pf = await platform();
  if (!pf) return J(200, { ok: false, error: 'platform_not_configured' });
  const stripe = new Stripe(key);

  // Retrieve the completed checkout session + its subscription.
  let session;
  try { session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] }); }
  catch (e) { return J(200, { ok: false, error: 'session_not_found', detail: String((e && e.message) || e).slice(0, 160) }); }

  if (session.mode !== 'subscription') return J(200, { ok: false, error: 'not_subscription' });
  // 'complete' = the customer finished checkout (card captured; a trial means no charge yet).
  if (session.status !== 'complete') return J(200, { ok: false, error: 'not_complete', status: session.status });
  const meta = session.metadata || {};
  if (String(meta.company_provision) !== '1') return J(200, { ok: false, error: 'not_a_signup' });

  let sub = session.subscription;
  if (typeof sub === 'string') { try { sub = await stripe.subscriptions.retrieve(sub); } catch (_) { sub = null; } }
  if (!sub) return J(200, { ok: false, error: 'no_subscription' });

  // Idempotent: if a company already maps to this subscription (the webhook won the race, or a
  // page refresh), reuse it — never provision twice. provision is also idempotent by slug, so a
  // double-fire can't create a duplicate shop.
  let companyId = null;
  try { companyId = await webhook.findCompanyId(pf, sub, session); } catch (_) {}
  if (!companyId) {
    try { companyId = await webhook.provisionFromMeta(pf, stripe, sub, Object.assign({}, sub.metadata, meta)); }
    catch (e) { return J(200, { ok: false, error: 'provision_failed', detail: String((e && e.message) || e).slice(0, 160) }); }
  }
  if (!companyId) return J(200, { ok: false, error: 'provision_failed' });

  // A fresh one-tap login straight into the setup wizard.
  const slug = String(meta.slug || '').trim();
  let login = '';
  try {
    const email = String(meta.email || '').trim().toLowerCase();
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    const mev = { queryStringParameters: { secret: admin, action: 'magiclink', email, redirect: `${SITE}/platform/onboard.html` } };
    const md = JSON.parse((await provision.handler(mev)).body || '{}');
    login = md.login_link || '';
  } catch (_) {}

  return J(200, { ok: true, company_id: companyId, slug, login_url: login || null,
    message: login ? 'Payment received — taking you to your setup…' : 'Payment received — check your email for a sign-in link.' });
};
