// Owner-only refund of a card payment. Finds the latest Stripe payment on a job,
// refunds it, and records customer_payment_refunded (the payments rollup nets it
// out + the board's 💵 paid tag clears). Gated by Teddy's tech PIN — NOT the
// office password, so only the owner can move money back out.
//
// POST { pin, job_id }  ->  { ok, amount, refunded }

'use strict';

const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function jsonResp(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

async function byAction(action) {
  const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 500, page: 1 }),
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d && d.items) || [];
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return jsonResp(400, { ok: false, error: 'invalid_json' }); }
  const jobId = parseInt(b.job_id, 10) || 0;
  const pin = String(b.pin || '');
  if (!jobId) return jsonResp(400, { ok: false, error: 'job_id required' });

  // owner-only gate
  try {
    const vr = await fetch(`${SITE}/.netlify/functions/verify-pin-proxy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ technician_id: 1, pin }),
    });
    const vd = await vr.json();
    if (!vd || !vd.success) return jsonResp(401, { ok: false, error: 'owner_pin_required' });
  } catch (_) { return jsonResp(502, { ok: false, error: 'auth_unavailable' }); }

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return jsonResp(200, { ok: false, error: 'stripe_not_configured' });

  try {
    // latest payment on this job that hasn't already been refunded
    const pays = (await byAction('customer_payment_received')).filter((r) => String(meta(r).job_id) === String(jobId));
    if (!pays.length) return jsonResp(200, { ok: false, error: 'no_payment_found' });
    const refunded = new Set((await byAction('customer_payment_refunded')).map((r) => meta(r).session_id).filter(Boolean));
    const target = pays.find((r) => meta(r).session_id && !refunded.has(meta(r).session_id));
    if (!target) return jsonResp(200, { ok: false, error: 'already_refunded' });
    const m = meta(target);

    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(m.session_id);
    const pi = session && session.payment_intent;
    if (!pi) return jsonResp(200, { ok: false, error: 'no_payment_intent' });
    const refund = await stripe.refunds.create({ payment_intent: pi });
    const amount = (refund && refund.amount != null) ? refund.amount / 100 : num(m.amount);

    await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ action: 'customer_payment_refunded', metadata: { job_id: jobId, session_id: m.session_id, amount: amount.toFixed(2), kind: m.kind || 'invoice', refund_id: refund.id, at_ms: Date.now() } }),
    });
    return jsonResp(200, { ok: true, refunded: true, amount });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message });
  }
};
