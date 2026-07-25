// save-availability — the warranty-intake light page's day picker writes the
// customer's available days straight onto the job (customer_preference_text), the
// same field the SMS availability reply lands in, so the office + tech + scheduler
// all read it the same way. No PII, no payer-type — keyed only by job_id.
//
//   POST { job_id, availability_text, unavailable_text? }  ->  { ok }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10);
  const avail = String(b.availability_text || '').trim().slice(0, 500);
  const unavail = String(b.unavailable_text || '').trim().slice(0, 300);
  if (!jobId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'job_id required' }) };
  if (!avail && !unavail) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'availability required' }) };

  const pref = [avail, unavail ? ('Can\'t do: ' + unavail) : ''].filter(Boolean).join(' · ');
  try {
    await crud.update(crud.TABLES.jobs, jobId, { customer_preference_text: pref });
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'save failed: ' + ((e && e.message) || e) }) };
  }
  try { await crud.logEvent('availability_captured_intake', { job_id: jobId, availability: pref, at_ms: Date.now() }); } catch (_) {}

  // ✅ Availability is the LAST step of intake (warranty flow AND the $50 Quick
  // Check both end here) — the true "customer finished" moment. Fire the
  // confirmation so nobody's left hanging after sending their video/model/days.
  // sendIntakeAck dedupes per job (won't double with the payment-received text)
  // and the guard enforces opt-out / quiet-hours. Best-effort — never block the save.
  try {
    const job = await crud.searchOne(crud.TABLES.jobs, { id: jobId });
    if (job) {
      const phone = job.customer_phone || job.phone || '';
      const name = job.customer_first || job.customer_first_name || '';
      const appliance = job.appliance_type || 'appliance';
      const consent = (job.sms_consent === false || String(job.sms_consent).toLowerCase() === 'no') ? 'no' : 'yes';
      if (phone) await require('./_lib/intake-ack').sendIntakeAck({ job_id: jobId, phone, name, appliance, availability: pref, consent, suppressed: false });
    }
  } catch (_) {}

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
