// send-waiver — text the customer their service-waiver link ahead of the visit, from the
// Teddy Tool (Teddy 2026-07-25). Kills the awkward door-step signature and surfaces the
// protection add-ons EARLY (revenue) — the tech fires it while already on the prep call.
// Resolves the phone server-side; the tag contains "intake" so it clears the intake-only
// gate (the waiver is the last step of intake). Logs waiver_sent so status reads update.
//   POST { job_id }  ->  { ok, sms, phone_present }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const SITE = 'https://tnapplianceexchange.net';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id, 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });

  let job = {}; try { job = (await crud.searchOne(crud.TABLES.jobs, { id: jobId })) || {}; } catch (_) {}
  const cust = job.customer_id ? ((await crud.searchOne(crud.TABLES.customer, { id: job.customer_id })) || {}) : {};
  const phone = cust.phone || cust.mobile_number || cust.phone_number || job.customer_phone || '';
  const first = (cust.first_name || job.customer_first_name || '').trim() || 'there';
  if (!phone) return json(200, { ok: false, phone_present: false, error: 'no phone on file' });

  const link = `${SITE}/waiver.html?job_id=${jobId}`;
  // GSM-7 (no em-dash) so it stays a single SMS segment. Add-ons are shown on the page.
  const body = `Hi ${first}, Tennessee Appliance Exchange. Please sign our quick service waiver before your visit: ${link}`;
  let smsOk = false;
  try { smsOk = !!(await sendSms(phone, body, 'customer', 'intake_waiver')); } catch (_) {}
  try { await crud.logEvent('waiver_sent', { job_id: jobId, via: 'teddy_tool', phone_present: true, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: smsOk, sms: smsOk, phone_present: true });
};
