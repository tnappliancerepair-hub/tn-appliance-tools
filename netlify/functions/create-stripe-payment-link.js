// Creates a Stripe Checkout Session for a self-pay job. Returns the
// hosted-checkout URL. Called by the colony-loop stripe_payment_link_due
// agent.
//
// ENV REQUIRED:
//   STRIPE_SECRET_KEY  (Live or test sk_ key)
//   STRIPE_SUCCESS_URL (optional; defaults to tnapplianceexchange.net/pay-thanks.html)
//   STRIPE_CANCEL_URL  (optional; defaults to tnapplianceexchange.net/customer-portal.html)
//
// Inputs: { job_id, amount_cents, description, customer_email?, customer_phone? }
//
// Falls back to placeholder mailto:tnappliancerepair@gmail.com link
// when STRIPE_SECRET_KEY is unset (so the agent flow still works in dev).
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const JOBS_TABLE = 7;
const EVENT_LOG_TABLE = 3;
// Add-on sales tax (tax-added): region from the job's tech, combined rate.
// These are reasonable defaults; refine with the CPA / a tax service later.
const TECH_REGION = { 1: 'TN', 2: 'TN', 3: 'LA', 4: 'TN', 5: 'LA', 6: 'LA' };
const TAX_RATE = { TN: 0.0975, LA: 0.0945 };
function metaHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
function rowMeta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

// For an invoice payment we look the job up server-side: NEVER charge a warranty
// customer, and pull the amount from the logged invoice (don't trust the client).
async function resolveInvoice(jobId) {
  const h = metaHeaders();
  if (!h) return { error: 'server_misconfigured' };
  // 1) job -> customer_type (warranty jobs are covered; no charge)
  try {
    const jr = await fetch(`${META}/table/${JOBS_TABLE}/content/${jobId}`, { headers: h });
    if (jr.ok) {
      const job = await jr.json();
      const ct = String((job && job.customer_type) || '').toLowerCase();
      if (ct && ct !== 'self_pay' && ct !== 'cash' && ct !== 'customer_pay') {
        return { error: 'covered_by_warranty' };
      }
    }
  } catch (_) {}
  // 2) latest office_invoice_logged for this job -> amount
  try {
    const ir = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ search: { action: 'office_invoice_logged' }, sort: { created_at: 'desc' }, per_page: 500, page: 1 }),
    });
    if (ir.ok) {
      const d = await ir.json();
      const rows = ((d && d.items) || []).filter((r) => String(rowMeta(r).job_id) === String(jobId));
      if (rows.length) {
        const amt = num(rowMeta(rows[0]).amount_invoiced);
        if (amt > 0) return { amountCents: Math.round(amt * 100) };
      }
    }
  } catch (_) {}
  return { error: 'no_invoice_due' };
}

// Region (TN/LA) for a job, from its assigned tech — drives the add-on tax rate.
async function jobRegion(jobId) {
  const h = metaHeaders();
  if (!h) return 'TN';
  try {
    const r = await fetch(`${META}/table/${JOBS_TABLE}/content/${jobId}`, { headers: h });
    if (r.ok) { const j = await r.json(); return TECH_REGION[parseInt(j && j.technician_id, 10)] || 'TN'; }
  } catch (_) {}
  return 'TN';
}

const DEFAULT_SUCCESS = 'https://tnapplianceexchange.net/pay-thanks.html?session_id={CHECKOUT_SESSION_ID}';
const DEFAULT_CANCEL = 'https://tnapplianceexchange.net/customer-portal.html';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const jobId = Number(body.job_id || 0);
  let amountCents = Number(body.amount_cents || 0);
  const description = String(body.description || `TN Appliance Exchange Job #${jobId}`);
  const customerEmail = String(body.customer_email || '').trim();

  // Optional passthrough metadata (e.g. an add-on purchase) so verify-payment
  // can record + fulfill the right thing. Stripe metadata values must be strings.
  const extraMeta = {};
  const m = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  for (const k of Object.keys(m)) { if (m[k] != null) extraMeta[k] = String(m[k]); }
  const kind = String(body.kind || extraMeta.kind || 'invoice');

  // Invoice payment with no amount passed -> resolve server-side (warranty guard
  // + amount from the logged invoice).
  if (kind === 'invoice' && jobId && amountCents <= 0) {
    const r = await resolveInvoice(jobId);
    if (r.error) return jsonResp(200, { ok: false, error: r.error });
    amountCents = r.amountCents;
  }

  if (!jobId || amountCents <= 0) {
    return jsonResp(400, { ok: false, error: 'job_id and amount_cents required' });
  }

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) {
    // Dev fallback — return a mailto so the agent flow can still run
    return jsonResp(200, {
      ok: true,
      placeholder: true,
      url: `mailto:tnappliancerepair@gmail.com?subject=Pay%20for%20job%20${jobId}&body=$${(amountCents/100).toFixed(2)}%20due`,
      note: 'STRIPE_SECRET_KEY not set — returned mailto placeholder',
    });
  }

  // Add-ons are "tax added": charge the price + sales tax. (Invoices already
  // include tax from the office worksheet; tips are not taxed.)
  let taxCents = 0, region = '', rate = 0;
  if (kind === 'addon') {
    region = await jobRegion(jobId);
    rate = TAX_RATE[region] || TAX_RATE.TN;
    taxCents = Math.round(amountCents * rate);
  }

  try {
    const stripe = new Stripe(key);
    const lineItems = [{
      price_data: { currency: 'usd', product_data: { name: description }, unit_amount: amountCents },
      quantity: 1,
    }];
    if (taxCents > 0) {
      lineItems.push({
        price_data: { currency: 'usd', product_data: { name: 'Sales tax (' + region + ' ' + (rate * 100).toFixed(2) + '%)' }, unit_amount: taxCents },
        quantity: 1,
      });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: process.env.STRIPE_SUCCESS_URL || DEFAULT_SUCCESS,
      cancel_url: process.env.STRIPE_CANCEL_URL || DEFAULT_CANCEL,
      customer_email: customerEmail || undefined,
      metadata: Object.assign({
        job_id: String(jobId),
        kind: kind,
        base_cents: String(amountCents),
        tax_cents: String(taxCents),
        tax_rate: String(rate),
        region: region,
        amount_cents: String(amountCents + taxCents),
        source: extraMeta.source || 'customer_portal_pay',
      }, extraMeta),
    });

    return jsonResp(200, {
      ok: true,
      url: session.url,
      session_id: session.id,
      amount_cents: amountCents,
      tax_cents: taxCents,
      total_cents: amountCents + taxCents,
    });
  } catch (err) {
    console.error('[create-stripe-payment-link] stripe error', err.message);
    return jsonResp(500, { ok: false, error: err.message });
  }
};

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
