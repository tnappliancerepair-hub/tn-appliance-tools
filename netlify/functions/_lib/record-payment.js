// Shared "a Stripe Checkout session got paid → record it" logic, used by both
// verify-payment.js (success-redirect) and stripe-payment-webhook.js (backstop).
// Idempotent per session_id so the two paths can't double-record / double-credit.

'use strict';

const { sendSms } = require('./sms');
const { getSecret } = require('./secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const JOBS_TABLE = 7;

// Best-effort SMS receipt to the customer who just paid (Stripe also emails one).
async function smsCustomer(jobId, kind, amount) {
  if (!jobId) return;
  let phone = '';
  try {
    const r = await fetch(`${META}/table/${JOBS_TABLE}/content/${jobId}`, { headers: headers() });
    if (r.ok) { const j = await r.json(); phone = String((j && j.customer_phone) || '').replace(/\D/g, ''); }
  } catch (_) { return; }
  if (!phone) return;
  const to = phone.length === 10 ? '+1' + phone : (phone.length === 11 ? '+' + phone : phone);
  const amt = '$' + Number(amount).toFixed(2);
  const text = kind === 'tip'
    ? 'TN Appliance Exchange: thank you for the tip! 100% goes straight to your tech — they\'ll see it. 🐜'
    : kind === 'addon'
      ? 'TN Appliance Exchange: got your order (' + amt + '). We\'ll take care of it with your repair. Thank you!'
      : 'TN Appliance Exchange: payment received — thank you! ' + amt + ' paid. A receipt is on the way to your email.';
  await sendSms(to, text, 'customer', 'payment_confirmation');
}

const OWNER = '+16154855795';    // Teddy
const DANIELLE = '+16154850713'; // office
// Field techs (id -> cell). On payment the job's tech also gets the "paid" text so
// they know their cut landed (Teddy 2026-07-30: "Danielle and me and Lee should get
// a group text once paid"). Owner (id 1) is omitted — they already get the OWNER text.
const TECH_PHONES = { 2: '+16159671304', 3: '+15049099413', 4: '+16158291654', 6: '+18133527686' };

// Let the shop know the moment money lands (Teddy 2026-07-27: "make the invoice let
// us know once paid"). Fires once — recordPaidSession is idempotent per session.
// techHint = the tech who did the work (from the pay-link metadata); falls back to
// the job's assigned tech so the right person is looped into the "paid" text.
async function notifyOffice(jobId, kind, amount, techHint) {
  const amt = '$' + Number(amount).toFixed(2);
  let name = '', appliance = '', jobTech = 0;
  try {
    const r = await fetch(`${META}/table/${JOBS_TABLE}/content/${jobId}`, { headers: headers() });
    if (r.ok) { const j = await r.json(); name = [(j.customer_first || ''), (j.customer_last || '')].join(' ').trim(); appliance = String(j.appliance_type || '').trim(); jobTech = parseInt(j.technician_id, 10) || 0; }
  } catch (_) {}
  const label = kind === 'tip' ? '💵 TIP PAID' : (kind === 'addon' ? '💵 ADD-ON PAID' : '💵 INVOICE PAID');
  const msg = label + ' ' + amt + (name ? ' · ' + name : '') + (appliance ? ' ' + appliance : '') + ' · job #' + jobId + ' (paid online) — marked paid on the board.';
  try { await sendSms(OWNER, msg, 'owner', 'payment_received'); } catch (_) {}
  try { await sendSms(DANIELLE, msg, 'office', 'payment_received'); } catch (_) {}
  // Loop the job's tech in too (skip if it's the owner — already texted above).
  const techId = parseInt(techHint, 10) || jobTech;
  const techPhone = TECH_PHONES[techId];
  if (techPhone) { try { await sendSms(techPhone, msg, 'technician', 'payment_received'); } catch (_) {} }
}

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
  const amount = (session && session.amount_total != null) ? session.amount_total / 100 : 0; // total charged (incl. tax + any tip)
  const tip = md.tip_cents != null ? Number(md.tip_cents) / 100 : 0; // customer tip (100% to tech) folded into this checkout
  const netAmount = Math.max(0, amount - tip); // the repair/add-on payment — tip excluded so it's never counted as revenue
  const base = md.base_cents != null ? Number(md.base_cents) / 100 : netAmount; // pre-tax (the add-on price / margin basis)
  const tax = md.tax_cents != null ? Number(md.tax_cents) / 100 : 0;
  const region = md.region || '';
  const jobId = Number(md.job_id) || 0;
  const kind = md.kind || 'invoice';

  if (!sessionId) return { recorded: false, duplicate: false, kind, amount, job_id: jobId };
  if (await alreadyRecorded(sessionId)) return { recorded: false, duplicate: true, kind, amount, job_id: jobId };

  await logRow('customer_payment_received', {
    session_id: sessionId, job_id: jobId, kind,
    amount: netAmount.toFixed(2), base: base.toFixed(2), tax: tax.toFixed(2), tip: tip.toFixed(2), region,
    addon_key: md.addon_key || null,
    source: md.source || 'customer_portal_pay', paid_at_ms: Date.now(),
  });
  // An OEM parts drop-ship (applianceant.com). No job — everything's in the
  // session metadata. Log oem_order_paid (flips the worklist to PAID), tell the
  // office it's ready to drop-ship, and receipt the customer with the
  // manufacturer-warranty note. Auto-placement is OFF by default (office taps
  // "Place" in oem-orders.html); flip OEM_AUTO_SHIP=true + vault
  // OEM_OFFICE_PASSWORD to auto-ship on payment once the flow is proven.
  if (kind === 'oem_part') {
    const reqId = md.request_id || '';
    await logRow('oem_order_paid', {
      request_id: reqId, session_id: sessionId, part_number: md.part_number || '', part_name: md.part_name || '',
      amount: amount.toFixed(2), ship_state: md.ship_state || md.region || '',
      ship_to: { name: md.ship_name || '', address1: md.ship_address1 || '', address2: md.ship_address2 || '', city: md.ship_city || '', state: md.ship_state || '', zip: md.ship_zip || '' },
      customer_phone: md.customer_phone || '', customer_email: md.customer_email || '', paid_at_ms: Date.now(),
    });
    const amt = '$' + Number(amount).toFixed(2);
    const line = '🔧💵 OEM PART PAID ' + amt + ' · ' + (md.part_name || md.part_number || 'part')
      + (md.ship_name ? ' · ' + md.ship_name : '') + ' → ' + [md.ship_city, md.ship_state].filter(Boolean).join(', ')
      + ' — place the drop-ship: tnapplianceexchange.net/oem-orders.html';
    try { await sendSms(OWNER, line, 'owner', 'oem_paid'); } catch (_) {}
    try { await sendSms(DANIELLE, line, 'office', 'oem_paid'); } catch (_) {}
    const ph = String(md.customer_phone || '').replace(/[^\d]/g, '');
    if (ph) {
      const e164 = ph.length === 10 ? '+1' + ph : (ph.length === 11 ? '+' + ph : md.customer_phone);
      try { await sendSms(e164, 'TN Appliance / Appliance Ant: payment received, ' + amt + ' — thank you! We\'re getting your ' + (md.part_name || 'part') + ' shipped and will follow up with tracking. It carries the manufacturer\'s warranty. 🐜', 'customer', 'oem_paid_receipt'); } catch (_) {}
    }
    if (String(process.env.OEM_AUTO_SHIP || '').toLowerCase() === 'true') {
      try {
        const base = process.env.URL || 'https://tnapplianceexchange.net';
        const pw = await getSecret('OEM_OFFICE_PASSWORD');
        if (pw) await fetch(base + '/.netlify/functions/oem-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'place', password: pw, request_id: reqId }), signal: AbortSignal.timeout(25000) });
      } catch (_) {}
    }
    return { recorded: true, duplicate: false, kind, amount, job_id: 0, request_id: reqId };
  }
  // A tip: 100% to the tech (shop absorbs the Stripe fee). Credits their pay.
  // Two shapes: a pure tip checkout (kind === 'tip', whole amount is the tip), OR a tip
  // folded into an invoice/add-on checkout (tip_cents > 0) — split back out here so the
  // tech gets it and it never counts as repair revenue.
  if (kind === 'tip' && md.technician_id) {
    await logRow('tech_tip_paid', {
      session_id: sessionId, job_id: jobId, technician_id: Number(md.technician_id),
      amount: amount.toFixed(2), tech_first: md.tech_first || '', source: 'customer_tip', at_ms: Date.now(),
    });
  } else if (tip > 0 && md.technician_id) {
    await logRow('tech_tip_paid', {
      session_id: sessionId, job_id: jobId, technician_id: Number(md.technician_id),
      amount: tip.toFixed(2), tech_first: md.tech_first || '', source: 'customer_tip_with_payment', at_ms: Date.now(),
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
      net_price: base.toFixed(2), price: base.toFixed(2), discount: '0.00',
      tech_cut: (md.tech_cut || '0'), cost: (md.cost || '0'),
      technician_id: md.technician_id ? Number(md.technician_id) : null,
      mode: md.mode || 'ship', status: 'requested', paid: true,
      source: 'customer_paid', requested_at_ms: Date.now(),
    });
  }
  await notifyOffice(jobId, kind, netAmount, md.technician_id);        // tell the shop (+ the tech) money came in (tip excluded)
  await smsCustomer(jobId, kind, kind === 'addon' ? base : netAmount); // best-effort receipt SMS
  return { recorded: true, duplicate: false, kind, amount, tip, job_id: jobId };
}

module.exports = { recordPaidSession };
