// Shared "a Stripe Checkout session got paid → record it" logic, used by both
// verify-payment.js (success-redirect) and stripe-payment-webhook.js (backstop).
// Idempotent per session_id so the two paths can't double-record / double-credit.

'use strict';

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

// session = a Stripe Checkout Session object (from retrieve or webhook payload).
// Returns { recorded: bool, duplicate: bool, kind, amount, job_id }.
async function recordPaidSession(session) {
  const md = (session && session.metadata) || {};
  const sessionId = session && session.id;
  const amount = (session && session.amount_total != null) ? session.amount_total / 100 : 0;
  const jobId = Number(md.job_id) || 0;
  const kind = md.kind || 'invoice';

  if (!sessionId) return { recorded: false, duplicate: false, kind, amount, job_id: jobId };
  if (await alreadyRecorded(sessionId)) return { recorded: false, duplicate: true, kind, amount, job_id: jobId };

  await logRow('customer_payment_received', {
    session_id: sessionId, job_id: jobId, kind,
    amount: amount.toFixed(2), addon_key: md.addon_key || null,
    source: md.source || 'customer_portal_pay', paid_at_ms: Date.now(),
  });
  // A tip: 100% to the tech (shop absorbs the Stripe fee). Credits their pay.
  if (kind === 'tip' && md.technician_id) {
    await logRow('tech_tip_paid', {
      session_id: sessionId, job_id: jobId, technician_id: Number(md.technician_id),
      amount: amount.toFixed(2), tech_first: md.tech_first || '', source: 'customer_tip', at_ms: Date.now(),
    });
  }
  // A paid add-on lands as a REQUEST flagged paid — so the office still sees it
  // in the "to fulfill" list (the part still has to be shipped/installed). The
  // tech is credited when the office marks it fulfilled (Ordered ✓), same as
  // every other add-on. (Previously this wrote addon_fulfilled directly, which
  // hid paid ship-only items from the office's to-ship queue.)
  if (kind === 'addon' && md.addon_key) {
    await logRow('addon_requested', {
      job_id: jobId, addon_key: md.addon_key, name: md.name || md.addon_key,
      net_price: amount.toFixed(2), price: amount.toFixed(2), discount: '0.00',
      tech_cut: (md.tech_cut || '0'), cost: (md.cost || '0'),
      technician_id: md.technician_id ? Number(md.technician_id) : null,
      mode: md.mode || 'ship', status: 'requested', paid: true,
      source: 'customer_paid', requested_at_ms: Date.now(),
    });
  }
  return { recorded: true, duplicate: false, kind, amount, job_id: jobId };
}

module.exports = { recordPaidSession };
