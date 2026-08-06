// pay-owed — the "what's owed" resolver behind the durable pay link (pay.html).
// ONE clean answer for "how much does this job owe, itemized" — so the customer
// gets a stable tnapplianceexchange.net/pay.html?job=&t= link that NEVER expires
// (the Stripe session is minted fresh when they tap Pay, not baked into the link).
//
// WARRANTY-SAFE by reuse: leans on the proven, warranty-guarded reads —
//   get-invoice-status (self_pay only, never a covered repair) + addons-for-job
//   (out-of-pocket add-ons, unpaid only). It can NEVER surface a charge for a
//   covered warranty repair. Never exposes part numbers (generic line labels only).
//
//   GET ?job=<id>&t=<token>          -> { ok, owed_cents, items, paid, pay_kind, ... }
//   GET ?job=<id>&mint=1&secret=<admin>  -> { ok, url } the durable pay link to send
'use strict';
const crypto = require('crypto');
const { getSecret } = require('./_lib/secrets');

const FN = 'https://tnapplianceexchange.net/.netlify/functions';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
// add-on sales tax by the job's tech region (matches create-stripe-payment-link)
const TECH_REGION = { 1: 'TN', 2: 'TN', 3: 'LA', 4: 'TN', 6: 'LA' };
const TAX_RATE = { TN: 0.0975, LA: 0.0945 };
exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function money(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
async function tokenSecret() { return (await getSecret('PAY_LINK_SECRET')) || (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5'; }
async function payToken(jobId) { return crypto.createHmac('sha256', await tokenSecret()).update('pay:' + jobId).digest('hex').slice(0, 12); }
// Hard-timeout every internal read (race a manual timer) so a slow/hanging
// dependency (e.g. addons-for-job stalling on some jobs) can NEVER stall the pay
// page — it degrades to null and the page still loads.
async function getJSON(url, opts, ms) {
  ms = ms || 6000;
  const fetchP = fetch(url, Object.assign({ signal: AbortSignal.timeout(ms) }, opts || {})).then((r) => r.json()).catch(() => null);
  const timer = new Promise((res) => setTimeout(() => res(null), ms + 200));
  return Promise.race([fetchP, timer]);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const jobId = parseInt(String(q.job || q.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job required' });

  // MINT mode (owner/office): return the durable link to copy + send.
  if (q.mint) {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
    const t = await payToken(jobId);
    return json(200, { ok: true, job_id: jobId, url: `${SITE}/pay.html?job=${jobId}&t=${t}` });
  }

  // Customer view: token must match (shareable, not guessable).
  if (q.t !== (await payToken(jobId))) return json(401, { ok: false, error: 'bad_link' });

  // Reuse the warranty-safe reads.
  const [inv, addons, jobinv, dash] = await Promise.all([
    getJSON(`${FN}/get-invoice-status?job_id=${jobId}`),
    getJSON(`${FN}/addons-for-job?job_id=${jobId}`),
    getJSON(`${FN}/get-job-invoice?job_id=${jobId}`),
    getJSON(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }) }),
  ]);

  const cust = (dash && dash.customer) || {};
  const first = cust.first_name || 'there';
  const appl = String((dash && dash.appliance && dash.appliance.type) || (dash && dash.job && dash.job.appliance_type) || '').trim();
  const selfPay = !!(inv && inv.self_pay);
  // The tech who did the work — so a tip credits the right person (100% to them).
  const techId = parseInt((dash && dash.tech && dash.tech.id) || (dash && dash.job && dash.job.technician_id), 10) || 0;
  const techFirst = String((dash && dash.tech && (dash.tech.first_name || (dash.tech.name || '').split(' ')[0])) || '').trim();

  const items = [];
  let owedCents = 0, paid = false, payKind = 'invoice', addonBaseCents = 0;

  if (selfPay) {
    // Self-pay: the office invoice total already folds in any add-ons. Charge it.
    payKind = 'invoice';
    paid = !!inv.paid;
    const amt = money(inv.amount);
    owedCents = paid ? 0 : Math.round(amt * 100);
    const iv = (jobinv && jobinv.invoice) || {};
    const push = (label, v) => { const c = Math.round(money(v) * 100); if (c > 0) items.push({ label, cents: c }); };
    push('Labor', iv.labor);
    push('Parts', money(iv.parts) || money(iv.partcost));
    push('Shipping', iv.ship);
    push('Tax', iv.tax);
    push('Tip', iv.tip);
    // fallback: if the itemization didn't add up (older invoice), show one line
    const sum = items.reduce((s, x) => s + x.cents, 0);
    if (!items.length || Math.abs(sum - Math.round(amt * 100)) > 50) { items.length = 0; items.push({ label: 'Repair invoice', cents: Math.round(amt * 100) }); }
  } else {
    // Warranty (covered repair) — ONLY out-of-pocket add-ons can be charged.
    payKind = 'addon';
    const base = money(addons && addons.unpaid_total);
    addonBaseCents = Math.round(base * 100);
    const region = TECH_REGION[parseInt((dash && dash.tech && dash.tech.id) || (dash && dash.job && dash.job.technician_id), 10)] || 'TN';
    const rate = TAX_RATE[region] || TAX_RATE.TN;
    const taxCents = Math.round(addonBaseCents * rate);
    for (const a of ((addons && addons.items) || [])) { if (!a.paid) { const c = Math.round(money(a.net_price) * 100); if (c > 0) items.push({ label: a.name || 'Add-on', cents: c }); } }
    if (taxCents > 0) items.push({ label: 'Sales tax', cents: taxCents });
    owedCents = addonBaseCents > 0 ? addonBaseCents + taxCents : 0;
    paid = addonBaseCents <= 0; // nothing unpaid = settled (or none)
  }

  return json(200, {
    ok: true, job_id: jobId, first, appliance: appl,
    self_pay: selfPay, pay_kind: payKind, addon_base_cents: addonBaseCents,
    items, owed_cents: owedCents, paid, nothing_due: owedCents <= 0 && !paid,
    technician_id: techId, tech_first: techFirst,
  });
};

module.exports.payToken = payToken;
