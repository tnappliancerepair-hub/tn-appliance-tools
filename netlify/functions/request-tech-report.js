'use strict';
// Office-initiated report nudge (Teddy's idea, 2026-06-16). Danielle taps
// "Request report" on a job whose TDR is incomplete → we text the assigned tech
// EXACTLY what's missing + a tap-to-call link so Ant calls them and finishes the
// report by voice. She stops chasing techs; Ant does the chasing, specifically.
//
// Office-initiated (deliberate), so it sends through the direct Netlify SMS path
// (bypasses the loop's automated weekend mute on purpose).
const { sendSms } = require('./_lib/sms');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';

// Tech roster phones (stable; matches vapi-out / verify-quickcheck hardcoding).
// Andre = 504-909-9413 (the number on his tech row). His old 615 silently gates.
const TECH_PHONES = {
  1: '+16154855795', 2: '+16159671304', 3: '+15049099413',
  4: '+16158291654', 5: '+17315049617', 6: '+18133527686',
};
const has = (v) => v != null && String(v).trim() !== '';

exports.handler = async function (event) {
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || 0);
  if (!jobId) return j(400, { ok: false, error: 'job_id required' });

  let d = {};
  try {
    const r = await fetch(`${XANO}/get_job_for_dashboard`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }),
    });
    d = await r.json();
  } catch (_) { return j(200, { ok: false, error: 'lookup_failed' }); }

  const job = d.job || {}, appl = d.appliance || {}, tdr = d.tdr || {}, cust = d.customer || {};
  const techId = Number(job.technician_id || 0);
  const techPhone = TECH_PHONES[techId];
  if (!techPhone) {
    // Clear, actionable message for the office instead of a cryptic code.
    return j(200, { ok: false, technician_id: techId, error: techId > 0
      ? ('Tech #' + techId + ' has no phone on file — fix the tech record before requesting the report.')
      : 'No tech is assigned to this job yet — assign a tech first, then request the report.' });
  }

  // What's still missing for a complete report (matches get_techs_with_open_tdr).
  const missing = [];
  if (!has(tdr.diagnosis)) missing.push('the diagnosis');
  if (!has(tdr.failure_cause)) missing.push('cause of failure');
  if (!has(tdr.failed_component)) missing.push('which part failed');
  if (!has(tdr.verified_part_number)) missing.push('part number');
  if (!has(tdr.repair_completed)) missing.push('what you did');
  if (!(Number(tdr.labor_time_hours) > 0)) missing.push('labor time');

  if (!missing.length) {
    return j(200, { ok: false, complete: true, error: 'report already complete', technician_id: techId });
  }

  const customer = cust.first_name || job.customer_first_name || 'the customer';
  const appliance = (appl.appliance_type || job.appliance_type || 'appliance').toLowerCase();
  const missingStr = missing.join(', ');

  const link = `${SITE}/.netlify/functions/start-report-call?job_id=${jobId}&tech_id=${techId}`;
  const body =
    `[ant] ${customer}'s ${appliance} report still needs: ${missingStr}. ` +
    `Tap and Ant will call you to finish it (he'll help find the part # too): ${link} ` +
    `— or call when you can. Sooner it's in, sooner it gets processed.`;

  let sent = false;
  try { await sendSms(techPhone, body, 'tech', 'report_nudge'); sent = true; } catch (_) {}
  return j(200, { ok: sent, technician_id: techId, customer, missing });
};

function j(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
