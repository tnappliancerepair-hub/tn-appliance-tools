// pm-charge — charge a property-management account's card on file for a completed job.
// The heart of the card-on-file system:
//   - net_terms account   -> don't charge; add the job to their monthly statement.
//   - card account, <= threshold (or approved)  -> auto-charge the saved card now.
//   - card account, > threshold and not approved -> text/email the PM a one-tap approve
//     link and hold; pm-approve.js finishes the charge once they tap it.
// The PM keeps spend control on big repairs; small ones bill themselves. Admin-gated.
//
// POST { secret, pm_key, amount_cents, job_id?, description?, actor?, approved? }
'use strict';
const Stripe = require('stripe');
const crypto = require('crypto');
const { getSecret } = require('./_lib/secrets');
const { getPmAccount } = require('./_lib/pm-accounts');
const { sendSms } = require('./_lib/sms');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const OWNER = '+16154855795', SITE = 'https://tnapplianceexchange.net';
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 200 : n).trim();
function authH() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }
async function logRow(action, metadata) { const h = authH(); if (!h) return; try { await fetch(`${META}/table/3/content`, { method: 'POST', headers: h, body: JSON.stringify({ action, metadata }) }); } catch (_) {} }

async function defaultPm(stripe, customerId) {
  const cust = await stripe.customers.retrieve(customerId);
  const def = cust && cust.invoice_settings && cust.invoice_settings.default_payment_method;
  if (def) return def;
  const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  return (list.data && list.data[0]) ? list.data[0].id : null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
  if (s(b.secret, 80) !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const pmKey = s(b.pm_key, 60);
  const amount = Math.round(Number(b.amount_cents) || 0);
  const jobId = s(b.job_id, 20);
  const description = s(b.description, 200) || ('Appliance repair' + (jobId ? (' — job #' + jobId) : ''));
  const actor = s(b.actor, 40) || 'office';
  const approved = b.approved === true || b.approved === 'true';
  if (!pmKey || amount <= 0) return json(400, { ok: false, error: 'pm_key + amount_cents required' });

  const acct = await getPmAccount(pmKey);
  if (!acct) return json(404, { ok: false, error: 'pm_account_not_found' });

  // NET TERMS: add to the monthly statement, don't charge.
  if (acct.track === 'net_terms') {
    await logRow('pm_statement_item', { pm_key: pmKey, company: acct.company, job_id: jobId, amount_cents: amount, description, actor, at_ms: Date.now() });
    return json(200, { ok: true, status: 'statement', amount_cents: amount, message: 'Added to ' + acct.company + ' monthly statement.' });
  }

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return json(500, { ok: false, error: 'stripe_not_configured' });
  const stripe = new Stripe(key);
  if (!acct.stripe_customer_id) return json(400, { ok: false, error: 'no_stripe_customer' });

  const threshold = Math.max(0, parseInt(acct.threshold_cents, 10) || 25000);

  // OVER THRESHOLD + not approved -> request one-tap approval, hold the charge.
  if (amount > threshold && !approved) {
    const token = crypto.randomBytes(16).toString('hex');
    await logRow('pm_charge_pending', { token, pm_key: pmKey, company: acct.company, job_id: jobId, amount_cents: amount, description, actor, created_ms: Date.now() });
    const link = `${SITE}/pm-approve.html?token=${token}`;
    const msg = 'TN Appliance: your ' + (jobId ? ('job #' + jobId + ' ') : '') + 'repair is $' + (amount / 100).toFixed(2) + '. Approve the charge to your card on file: ' + link;
    let notified = false;
    if (acct.phone) { try { await sendSms(acct.phone, msg, 'customer', 'pm_charge_approval'); notified = true; } catch (_) {} }
    try { await sendSms(OWNER, '[ant] PM approval sent: ' + acct.company + ' $' + (amount / 100).toFixed(2) + (jobId ? (' job #' + jobId) : '') + (notified ? '' : ' (no PM phone — send them ' + link + ')'), 'owner', 'pm_charge_approval'); } catch (_) {}
    return json(200, { ok: true, status: 'awaiting_approval', token, approve_url: link, amount_cents: amount, threshold_cents: threshold, pm_notified: notified });
  }

  // CHARGE THE CARD ON FILE (off-session).
  try {
    const pm = await defaultPm(stripe, acct.stripe_customer_id);
    if (!pm) return json(400, { ok: false, status: 'no_card', error: 'No card on file — send the PM a setup link first.' });
    const intent = await stripe.paymentIntents.create({
      amount, currency: 'usd', customer: acct.stripe_customer_id, payment_method: pm,
      off_session: true, confirm: true, description,
      metadata: { pm_key: pmKey, company: acct.company || '', job_id: jobId, actor, source: 'pm_card_on_file' },
    });
    if (intent.status === 'succeeded') {
      await logRow('pm_payment', { pm_key: pmKey, company: acct.company, job_id: jobId, amount_cents: amount, description, actor, payment_intent_id: intent.id, approved: approved, at_ms: Date.now() });
      try { await sendSms(OWNER, '[ant] 💳 PM charged: ' + acct.company + ' $' + (amount / 100).toFixed(2) + (jobId ? (' job #' + jobId) : '') + ' ✓', 'owner', 'pm_charged'); } catch (_) {}
      return json(200, { ok: true, status: 'charged', payment_intent_id: intent.id, amount_cents: amount });
    }
    await logRow('pm_charge_failed', { pm_key: pmKey, job_id: jobId, amount_cents: amount, intent_status: intent.status, at_ms: Date.now() });
    return json(200, { ok: false, status: intent.status, payment_intent_id: intent.id, error: 'charge_not_completed' });
  } catch (err) {
    // off_session cards can require authentication, or be declined.
    const code = (err && err.code) || '';
    await logRow('pm_charge_failed', { pm_key: pmKey, job_id: jobId, amount_cents: amount, error: err.message, code, at_ms: Date.now() });
    try { await sendSms(OWNER, '[ant] ⚠ PM charge FAILED: ' + acct.company + ' $' + (amount / 100).toFixed(2) + ' — ' + (code || err.message), 'owner', 'pm_charge_failed'); } catch (_) {}
    return json(200, { ok: false, status: 'failed', code, error: err.message });
  }
};
