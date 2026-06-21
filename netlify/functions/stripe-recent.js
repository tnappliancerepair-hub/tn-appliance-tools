// stripe-recent — token-gated: lists recent PAID Stripe checkout sessions so we
// can cross-reference against jobs (did a real payment get missed when the
// webhook was down?). Read-only. Uses the vault Stripe key.
//   GET ?key=<guard>&days=10
'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const GUARD = 'tn-stripe-check-2026';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if ((q.key || '') !== GUARD) return { statusCode: 401, body: 'unauthorized' };
  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'no STRIPE_SECRET_KEY in vault/env' }) };
  try {
    const stripe = new Stripe(key);
    const days = parseInt(q.days || '10', 10);
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const list = await stripe.checkout.sessions.list({ limit: 100, created: { gte: since } });
    const sessions = list.data
      .filter((s) => s.payment_status === 'paid')
      .map((s) => ({
        id: s.id,
        amount: (s.amount_total || 0) / 100,
        created: new Date(s.created * 1000).toISOString(),
        email: (s.customer_details && s.customer_details.email) || (s.metadata && s.metadata.email) || null,
        name: (s.metadata && s.metadata.name) || null,
        phone: (s.metadata && s.metadata.phone) || null,
        kind: (s.metadata && s.metadata.kind) || null,
        is_test: (s.metadata && s.metadata.is_test) || null,
      }));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, paid_count: sessions.length, sessions }, null, 2) };
  } catch (e) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
