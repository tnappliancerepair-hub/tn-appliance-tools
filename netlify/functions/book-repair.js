// book-repair — the low-friction "Book a repair" door for cash/self-pay web leads.
// Captures name + phone + what's wrong (address optional), creates a clean self-pay
// job, and fires a SPEED-TO-LEAD text to the customer within seconds (whoever answers
// first wins the cash job). Reliable — sends directly, not via the (intermittent) loop.
//
//   POST { first_name, last_name?, phone, address?, city?, state?, zip?,
//          appliance_type?, brand?, problem, availability?, sms_consent? }
//   -> { ok, job_id }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') return '+' + d; if (d.length === 10) return '+1' + d; return d ? ('+' + d) : ''; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const first = String(b.first_name || '').trim();
  const phoneDigits = String(b.phone || '').replace(/\D/g, '');
  const zip = String(b.zip || '').replace(/\D/g, '').slice(0, 5);
  const problem = String(b.problem || b.problem_summary || '').trim();
  const appliance = String(b.appliance_type || '').trim();
  if (!first || phoneDigits.length < 10 || !problem) {
    return json(400, { ok: false, error: "Please include your name, phone, and what's wrong." });
  }

  // create_job_from_chat has no structured address field — fold the street address
  // into the problem summary so the office/tech still see it.
  const addr = [b.address, b.city, b.state].map((s) => String(s || '').trim()).filter(Boolean).join(', ');
  const summary = problem + (addr ? ('\n\nService address: ' + addr + (zip ? (' ' + zip) : '')) : '');

  // 1) create the self-pay job
  let job = null;
  try {
    const r = await fetch(XANO + '/create_job_from_chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: first, last_name: String(b.last_name || '').trim(), phone: phoneDigits, zip: zip || '00000',
        appliance_type: appliance, brand: String(b.brand || '').trim(), model_number: String(b.model_number || '').trim(),
        problem_summary: summary, customer_type: 'self_pay', channel: 'web_book',
        customer_preference_text: String(b.availability || '').trim(), sms_consent: true, recommended_service: 'repair',
      }),
      signal: AbortSignal.timeout(15000),
    });
    job = await r.json();
  } catch (e) { return json(200, { ok: false, error: 'Could not submit — please try again or call 615-280-2949.' }); }
  const jobId = Number(job && (job.id || job.job_id)) || 0;
  if (!jobId) return json(200, { ok: false, error: 'Could not submit — please call 615-280-2949.' });

  // 2) SPEED-TO-LEAD — text the customer within seconds (the conversion lever).
  // Ask for the model-# photo + a short problem video; these upload onto the job
  // and feed the Teddy Tool so the owner pre-diagnoses from real media, not a blank.
  const apl = appliance ? (' ' + appliance.toLowerCase()) : ' appliance';
  const uploadUrl = 'https://tnapplianceexchange.net/finish-upload.html?job_id=' + jobId;
  const msg = 'Hi ' + first + ", this is TN Appliance Exchange 🐜 — got your" + apl + " repair request! Quick favor so we can help you fast: tap here to send a photo of the model-number sticker + a short video of the problem → " + uploadUrl + " . Then we'll text you to set up the visit. (Or call/text 615-280-2949.)";
  try {
    await fetch(XANO + '/send_sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: e164(phoneDigits), message: msg, customer_first_name: first, context_tag: 'web_book_speed_to_lead' }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {}

  // 3) we just texted them — suppress the loop's duplicate greeting + log the lead
  try { await crud.logEvent('new_job_greeting_sent', { job_id: jobId, source: 'web_book', via: 'speed_to_lead', at_ms: Date.now() }); } catch (_) {}
  try { await crud.logEvent('web_book_lead', { job_id: jobId, first_name: first, phone: phoneDigits, appliance, zip, at_ms: Date.now() }); } catch (_) {}

  return json(200, { ok: true, job_id: jobId });
};
