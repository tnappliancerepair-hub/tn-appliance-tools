// Confirms a Stripe Checkout payment after the success redirect, and records
// it — no webhook secret needed (only STRIPE_SECRET_KEY). Idempotent per
// session_id so a page refresh can't double-record / double-credit.
//
// GET /.netlify/functions/verify-payment?session_id=cs_...
// -> { ok, paid, kind, amount, job_id }
//
// On a paid add-on it also writes addon_fulfilled (mode + tech_cut + cost +
// technician_id) so the tech earns their cut and the office sees it to ship.

'use strict';

const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function logRow(action, metadata) {
  const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ action, metadata }),
  });
  return r.ok;
}
// Has this Stripe session already been recorded? (scan recent payment rows)
async function alreadyRecorded(sessionId) {
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ search: { action: 'customer_payment_received' }, sort: { created_at: 'desc' }, per_page: 500, page: 1 }),
    });
    if (!r.ok) return false;
    const d = await r.json();
    return ((d && d.items) || []).some((row) => meta(row).session_id === sessionId);
  } catch (_) { return false; }
}

function jsonResp(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const sessionId = ((event.queryStringParameters || {}).session_id || '').trim();
  if (!sessionId) return jsonResp(400, { ok: false, error: 'session_id required' });

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return jsonResp(200, { ok: false, error: 'stripe_not_configured' });

  try {
    const stripe = new Stripe(key);
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = s && s.payment_status === 'paid';
    const md = (s && s.metadata) || {};
    const amount = (s && s.amount_total != null) ? s.amount_total / 100 : 0;
    const jobId = Number(md.job_id) || 0;
    const kind = md.kind || 'invoice';

    if (!paid) return jsonResp(200, { ok: true, paid: false, kind, amount, job_id: jobId });

    // Idempotent: only record once per session.
    if (!(await alreadyRecorded(sessionId))) {
      await logRow('customer_payment_received', {
        session_id: sessionId, job_id: jobId, kind,
        amount: amount.toFixed(2), addon_key: md.addon_key || null,
        source: md.source || 'customer_portal_pay', paid_at_ms: Date.now(),
      });
      // A paid add-on becomes fulfilled — credits the tech + tells the office to ship/do it.
      if (kind === 'addon' && md.addon_key) {
        await logRow('addon_fulfilled', {
          job_id: jobId, addon_key: md.addon_key, name: md.name || md.addon_key,
          net_price: amount.toFixed(2), price: amount.toFixed(2), discount: '0.00',
          tech_cut: (md.tech_cut || '0'), cost: (md.cost || '0'),
          technician_id: md.technician_id ? Number(md.technician_id) : null,
          mode: md.mode || 'ship', status: 'fulfilled', paid: true,
          source: 'customer_paid', requested_at_ms: Date.now(),
        });
      }
    }
    return jsonResp(200, { ok: true, paid: true, kind, amount, job_id: jobId });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message });
  }
};
