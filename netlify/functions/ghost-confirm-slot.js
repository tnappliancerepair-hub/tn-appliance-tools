// ghost-confirm-slot — the customer-confirm step of shadow-mode ghost scheduling.
// Ant proposes a tech+day on the board; instead of locking it, the office taps
// "Confirm w/ customer" and this texts the customer to confirm the DAY works
// (day-of routing model — no specific time). Their YES/different-day reply lands
// in office Messages, and the office locks it with "✓ Use this" once confirmed.
//
//   POST { job_id, tech_id, date, day_label, tech_name }
//   -> { ok, sent, phone_last4, day }
'use strict';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
function first(s) { return String(s || '').trim().split(/\s+/)[0] || ''; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id, 10);
  if (!jobId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'job_id required' }) };

  const dayLabel = String(b.day_label || b.date || 'that day').trim();
  const techName = first(b.tech_name) || 'your tech';

  // Look up the customer phone + name + appliance from the job.
  let phone = '', cust = 'there', appl = 'appliance';
  try {
    const r = await fetch(`${XANO}/get_job_for_dashboard?job_id=${jobId}`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json().catch(() => ({}));
    const j = (d && (d.job || d)) || {};
    const c = (d && d.customer) || j.customer || {};
    phone = c.phone || j.customer_phone || j.phone || '';
    cust = first(c.first_name || j.customer_first || j.first_name) || 'there';
    appl = (j.appliance_type || j.appliance || 'appliance');
  } catch (_) {}

  if (!phone || phone.replace(/\D/g, '').length < 10) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'no customer phone on file — confirm by hand' }) };
  }

  const msg = `Hi ${cust} — this is TN Appliance Exchange 🐜. We can get ${techName} out to you ${dayLabel} for your ${appl}. Does that day work? Reply YES to confirm, or let us know a better day and we'll get you set.`;

  let sent = false, sendErr = null;
  try {
    const r = await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, message: msg, context_tag: 'ghost_slot_confirm' }),
      signal: AbortSignal.timeout(9000),
    });
    const d = await r.json().catch(() => ({}));
    sent = !!(d && d.success);
    if (!sent) sendErr = (d && d.error) || 'send failed';
  } catch (e) { sendErr = String((e && e.message) || e); }

  // Record the proposal so the board can show "awaiting customer confirm".
  try {
    await fetch(`${XANO}/record_event_log`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ghost_slot_proposed',
        metadata_json: JSON.stringify({ job_id: jobId, tech_id: b.tech_id || null, date: b.date || null, day_label: dayLabel, tech_name: techName, sent, at_ms: Date.now() }),
      }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (_) {}

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: sent, sent, error: sent ? null : sendErr, phone_last4: phone.replace(/\D/g, '').slice(-4), day: dayLabel }) };
};
