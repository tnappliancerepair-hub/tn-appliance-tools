// send-pay-link — Phase 2 of the durable pay link: ONE tap in the office texts the
// customer their stable tnapplianceexchange.net/pay.html?job=&t= link (never expires).
// Replaces the old "text a pay-now link" button that sent an EXPIRING Stripe checkout.
//
// Fully server-side: resolves the customer's phone, mints the durable link (HMAC token
// stays server-side — never exposed to the browser), and sends from the human line
// (857-8800, our approved 10DLC number), logging it to the per-job thread. Opt-out
// absolute. Same URL every time (idempotent — resend is safe, no regeneration).
//
//   POST { job_id }  ->  { ok, sent, reason? }
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const guard = require('./_lib/sms-guard');
const { payToken } = require('./pay-owed');

const TELNYX = 'https://api.telnyx.com/v2';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const HUMAN_LINE = '+16158578800';   // approved 10DLC human/office line (matches human-line-send)
const CORS = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return String(p || '').startsWith('+') ? String(p) : null; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });

  // Resolve the customer (phone + name + appliance) server-side.
  let cust = {}, appl = '';
  try {
    const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(9000) }).then((r) => r.json());
    cust = (d && d.customer) || {};
    appl = String((d && d.appliance && d.appliance.type) || (d && d.job && d.job.appliance_type) || '').trim();
  } catch (_) {}
  const to = e164(cust.phone);
  if (!to) return json(200, { ok: false, sent: false, reason: 'no_phone' });

  // Opt-out is absolute.
  try { if (await guard.isOptedOut(to)) return json(200, { ok: false, sent: false, reason: 'opted_out' }); } catch (_) {}

  // Mint the durable link (token stays here — never sent to the client).
  const url = `${SITE}/pay.html?job=${jobId}&t=${await payToken(jobId)}`;
  const first = cust.first_name || 'there';
  // GSM-7 (no em-dash) => single SMS segment.
  const msg = `Hi ${first}, secure link to pay for your${appl ? ' ' + appl : ''} repair - card or Apple Pay, never expires: ${url}`;

  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return json(200, { ok: false, sent: false, reason: 'sms_not_configured' });

  let sent = false, err = null;
  try {
    const r = await fetch(`${TELNYX}/messages`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: HUMAN_LINE, to, text: msg }), signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    sent = r.ok; if (!r.ok) err = JSON.stringify(d.errors || d).slice(0, 200);
  } catch (e) { err = String((e && e.message) || e); }

  if (sent) {
    try { await crud.logEvent('customer_sms_reply', { phone: to, to, from: HUMAN_LINE, body: msg.slice(0, 400), message: msg.slice(0, 400), source: 'human_line', lane: 'human', sender: String(b.sender || 'office'), job_id: jobId, at_ms: Date.now(), kind: 'pay_link' }); } catch (_) {}
    try { await crud.logEvent('pay_link_sent', { job_id: jobId, to, at_ms: Date.now() }); } catch (_) {}
  }
  return json(200, { ok: sent, sent, reason: err || undefined });
};
