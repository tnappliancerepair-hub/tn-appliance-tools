// tech-addon-pay-link — a tech, on their own job, adds an add-on (fridge water
// line, dryer clean-out, coil clean, etc.) and texts the CUSTOMER a tap-to-pay
// link — all from the field app, no office step (Teddy 2026-07-30: "I'd like
// techs to be able to add them on their job themselves"). Mirrors the office flow
// we do by hand: create the add-on Stripe link, credit the tech, text the link.
//
// The tech never handles the raw phone — resolved server-side from job_id (same
// chain as tech-customer-message). On payment, record-payment fires the "PAID"
// group text to Teddy + Danielle + this tech (technician_id rides the link).
//
//   POST { job_id, tech_id, addon_key, name, price, tech_cut }  ->  { ok, texted, to_masked }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const JOBS = crud.TABLES.jobs;         // 7
const CUSTOMER = crud.TABLES.customer; // 6
const SITE = process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net';
const TECH_NAME = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
function json(c, b) { return { statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function last10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? '(' + d.slice(-10, -7) + ') ***-' + d.slice(-4) : ''; }

// Same resolution chain tech-customer-message + sms-thread use: job denorm ->
// customer record -> job-truth fallback (covers warranty jobs missing the denorm).
async function resolveCustomer(jobId) {
  let phone10 = '', first = '', customerId = 0;
  try {
    const job = await crud.searchOne(JOBS, { id: jobId });
    if (job) {
      customerId = Number(job.customer_id) || 0;
      phone10 = last10(job.customer_phone) || last10(job.phone) || last10(job.bill_to_phone);
      first = String(job.customer_first || '').trim();
      if ((!phone10 || !first) && customerId) {
        const cust = await crud.searchOne(CUSTOMER, { id: customerId });
        if (cust) {
          phone10 = phone10 || last10(cust.phone) || last10(cust.mobile) || last10(cust.phone_number);
          first = first || String(cust.first_name || cust.name || '').trim().split(/\s+/)[0] || '';
        }
      }
    }
  } catch (_) {}
  if (!phone10) {
    try {
      const tr = await fetch(`${SITE}/.netlify/functions/job-truth?job_id=${jobId}&lens=office`, { signal: AbortSignal.timeout(7000) }).then((r) => r.json());
      phone10 = last10((tr && tr.facts && tr.facts.customer_phone) || '');
      first = first || String((tr && tr.facts && tr.facts.customer_first) || '').trim();
    } catch (_) {}
  }
  return { phone10, first };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }
  const jobId = Number(b.job_id || 0);
  const techId = Number(b.tech_id || 0);
  const addonKey = String(b.addon_key || '').trim();
  const name = String(b.name || addonKey);
  const price = Number(b.price || 0);
  const techCut = Number(b.tech_cut || 0);
  if (!jobId || !addonKey || price <= 0) return json(400, { ok: false, error: 'job_id, addon_key, price required' });

  const { phone10, first } = await resolveCustomer(jobId);
  if (!phone10) return json(200, { ok: false, error: 'no phone on file for this job — add one on the office board first' });

  // 1) create the add-on pay link (technician_id rides it so the "paid" text
  //    reaches this tech; kind:'addon' is never warranty-gated).
  let url = '';
  try {
    const r = await fetch(`${SITE}/.netlify/functions/create-stripe-payment-link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId, amount_cents: Math.round(price * 100), description: name, kind: 'addon', technician_id: techId,
        metadata: { addon_key: addonKey, name, mode: 'installed', tech_cut: String(techCut), technician_id: String(techId), source: 'tech_addon' },
      }),
    });
    const d = await r.json();
    if (d && d.ok && d.url && !d.placeholder) url = d.url;
    else return json(200, { ok: false, error: (d && d.error) || 'could not create pay link' });
  } catch (_) { return json(200, { ok: false, error: 'pay-link error' }); }

  // 2) record the add-on fulfilled -> credits the tech now (the work is done);
  //    paid flips when the customer pays the link. addons-for-job dedupes so it
  //    never double-bills against the office worksheet.
  try {
    await fetch(`${SITE}/.netlify/functions/record-addon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, technician_id: techId, addon_key: addonKey, name, price, tech_cut: techCut, status: 'fulfilled', mode: 'installed', source: 'tech_addon' }),
    });
  } catch (_) {}

  // 3) text the customer the pay-now link, identified as the tech.
  const who = TECH_NAME[techId] ? TECH_NAME[techId] + ' (TN Appliance)' : 'TN Appliance';
  const msg = `${who}: here's your ${name.toLowerCase()} — $${price.toFixed(0)} (tax added at checkout). Tap to pay and you're all set: ${url}`;
  let texted = false, sendErr = '';
  try {
    const sr = await fetch(`${SITE}/.netlify/functions/human-line-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone10, message: msg, job_id: jobId, sender: (TECH_NAME[techId] || 'tech') }),
    });
    const sd = await sr.json();
    texted = !!(sd && sd.sent);
    if (!texted) sendErr = (sd && (sd.reason || sd.error)) || 'send failed';
  } catch (_) { sendErr = 'send error'; }

  try { await crud.logEvent('tech_addon_pay_link_sent', { job_id: jobId, technician_id: techId, addon_key: addonKey, name, price, texted, to_masked: mask(phone10), at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: true, texted, to_masked: mask(phone10), url_created: true, error: texted ? undefined : sendErr });
};
