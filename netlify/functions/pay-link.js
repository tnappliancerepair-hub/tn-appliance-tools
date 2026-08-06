// pay-link — the field/office "get paid" brain. ONE call gives the tech everything to
// collect at the door, all routed through the DURABLE pay page (pay.html, never expires):
//   • the durable URL (for a QR the customer scans, or to open on the tech's phone),
//   • a QR SVG of that URL (server-rendered — nothing to hand over),
//   • the itemized amount owed + paid status (warranty-safe, straight from pay-owed).
//
// The HMAC token is minted HERE (server-side) and only the finished URL/QR leave — the
// signing secret never reaches the browser. Optionally records a self-pay amount first
// (record_job_invoice) so the durable page charges exactly what the tech confirmed.
//
// Reuses the proven warranty guards: pay-owed leans on get-invoice-status (self_pay only)
// + addons-for-job (out-of-pocket only), so this can NEVER surface a charge on a covered
// warranty repair. No secret required — job-scoped, amount/phone resolved server-side.
//
//   POST { job_id, amount? }  ->  { ok, url, qr_svg, owed_cents, items, paid, pay_kind, ... }
'use strict';
const qrcode = require('qrcode-generator');
const { payToken } = require('./pay-owed');

const FN = 'https://tnapplianceexchange.net/.netlify/functions';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'content-type': 'application/json' };
exports.config = { timeout: 20 };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function money(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
async function getJSON(url, opts, ms) {
  ms = ms || 7000;
  const p = fetch(url, Object.assign({ signal: AbortSignal.timeout(ms) }, opts || {})).then((r) => r.json()).catch(() => null);
  return Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms + 200))]);
}
function qrSvg(text) {
  try { const qr = qrcode(0, 'M'); qr.addData(String(text)); qr.make(); return qr.createSvgTag({ cellSize: 6, margin: 2 }); }
  catch (_) { return ''; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });

  // Optional: the tech confirmed/edited the self-pay amount -> record it so the durable
  // page charges exactly that. Warranty jobs ignore this downstream (pay-owed charges
  // out-of-pocket add-ons only), so it can't turn a covered repair into a charge.
  const amount = money(b.amount);
  if (amount > 0) {
    try {
      await fetch(`${XANO}/record_job_invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, technician_id: b.technician_id || 0, amount_invoiced: amount.toFixed(2) }),
        signal: AbortSignal.timeout(9000),
      });
    } catch (_) {}
  }

  // Mint the durable link + read what's owed (warranty-safe) through pay-owed.
  const token = await payToken(jobId);
  const url = `${SITE}/pay.html?job=${jobId}&t=${token}`;
  const owed = await getJSON(`${FN}/pay-owed?job=${jobId}&t=${token}`) || {};

  return json(200, {
    ok: true, job_id: jobId, url, qr_svg: qrSvg(url),
    owed_cents: owed.owed_cents || 0, items: owed.items || [], paid: !!owed.paid,
    nothing_due: !!owed.nothing_due, pay_kind: owed.pay_kind || 'invoice',
    self_pay: !!owed.self_pay, first: owed.first || 'there', appliance: owed.appliance || '',
  });
};
