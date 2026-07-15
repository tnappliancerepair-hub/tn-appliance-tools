// pm-card-status — read a PM billing account: its config (track, threshold, contacts) and
// whether a card is on file (brand + last4 + expiry, pulled live from Stripe). Also lists
// all PM accounts. Admin-gated. Card details come from Stripe; we never store the number.
//
//   GET ?secret=<admin>&pm_key=<key>   -> { ok, account, card }
//   GET ?secret=<admin>&list=1         -> { ok, accounts:[...] }
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { getPmAccount, listPmAccounts } = require('./_lib/pm-accounts');
exports.config = { timeout: 20 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
const s = (v) => String(v == null ? '' : v).trim();

async function cardFor(stripe, customerId) {
  if (!customerId) return null;
  try {
    const cust = await stripe.customers.retrieve(customerId);
    const defPm = cust && cust.invoice_settings && cust.invoice_settings.default_payment_method;
    const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 5 });
    const cards = (list.data || []).map((pm) => ({ id: pm.id, brand: (pm.card || {}).brand, last4: (pm.card || {}).last4, exp: ((pm.card || {}).exp_month) + '/' + ((pm.card || {}).exp_year), is_default: pm.id === defPm }));
    if (!cards.length) return null;
    const chosen = cards.find((c) => c.is_default) || cards[0];
    return { on_file: true, count: cards.length, brand: chosen.brand, last4: chosen.last4, exp: chosen.exp, payment_method_id: chosen.id };
  } catch (e) { return { on_file: false, error: e.message }; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (s(q.secret) !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const key = await getSecret('STRIPE_SECRET_KEY');
  const stripe = key ? new Stripe(key) : null;

  try {
    if (q.list === '1') {
      const accounts = await listPmAccounts();
      return json(200, { ok: true, count: accounts.length, accounts: accounts.map((a) => ({ pm_key: a.pm_key, company: a.company, track: a.track, threshold_cents: a.threshold_cents, has_customer: !!a.stripe_customer_id, contact: a.contact, phone: a.phone, email: a.email })) });
    }
    const pmKey = s(q.pm_key);
    if (!pmKey) return json(400, { ok: false, error: 'pm_key or list=1 required' });
    const acct = await getPmAccount(pmKey);
    if (!acct) return json(200, { ok: true, account: null });
    const card = stripe ? await cardFor(stripe, acct.stripe_customer_id) : null;
    return json(200, { ok: true, account: { pm_key: acct.pm_key, company: acct.company, track: acct.track, threshold_cents: acct.threshold_cents, contact: acct.contact, phone: acct.phone, email: acct.email, stripe_customer_id: acct.stripe_customer_id }, card });
  } catch (err) {
    return json(500, { ok: false, error: err.message });
  }
};
