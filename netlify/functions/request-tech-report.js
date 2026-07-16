'use strict';
// Office-initiated report nudge (Teddy's idea, 2026-06-16). Danielle taps
// "Request report" on a job whose TDR is incomplete → we text the assigned tech
// EXACTLY what's missing + a tap-to-call link so Ant calls them and finishes the
// report by voice. She stops chasing techs; Ant does the chasing, specifically.
//
// Office-initiated (deliberate), so it sends through the direct Netlify SMS path
// (bypasses the loop's automated weekend mute on purpose).
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');
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
  // get_job_for_dashboard returns the assigned tech as a separate d.tech object, and
  // job.technician_id often comes back null in that response — so fall back to tech.id
  // (same resolution the board drawer uses). Without this, an assigned job reads as "no tech."
  const techObj = d.tech || {};
  const techId = Number(job.technician_id || techObj.id || techObj.technician_id || 0);
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

  // A free-text ask from the office ("was the customer home?", "confirm the model").
  const note = String(b.note || '').replace(/\s+/g, ' ').trim().slice(0, 240);

  // Nothing missing AND nothing to ask → the report's already done, don't nag.
  if (!missing.length && !note) {
    return j(200, { ok: false, complete: true, error: 'report already complete', technician_id: techId });
  }

  const customer = cust.first_name || job.customer_first_name || 'the customer';
  const appliance = (appl.appliance_type || job.appliance_type || 'appliance').toLowerCase();
  const missingStr = missing.join(', ');

  const callLink = `${SITE}/.netlify/functions/start-report-call?job_id=${jobId}&tech_id=${techId}`;
  // A specific ask opens the ACTUAL job tile (its report), so the tech taps once and
  // lands on the exact job — no digging (Teddy 2026-07-16: "the tech gets the actual
  // job to open instead of searching for it"). The generic finish-nudge keeps the
  // one-tap Ant-calls-you path.
  const jobLink = `${SITE}/tech-job.html?job_id=${jobId}&tech_id=${techId}#tdr`;
  const body = note
    ? (`[ant] ${customer}'s ${appliance} — ${note}. ` +
       `Tap to open the job and add it: ${jobLink}`)
    : (`[ant] ${customer}'s ${appliance} report still needs: ${missingStr}. ` +
       `Tap and Ant will call you to finish it (he'll help find the part # too): ${callLink} ` +
       `— or call when you can. Sooner it's in, sooner it gets processed.`);

  if (b.dryrun === true || b.dryrun === '1') {
    return j(200, { ok: true, dryrun: true, technician_id: techId, tech_phone_on_file: !!techPhone, customer, missing, note, red_box: true });
  }
  let sent = false;
  try { await sendSms(techPhone, body, 'tech', 'report_nudge'); sent = true; } catch (_) {}
  // Record the ask so the tech's dashboard red box lights up for THIS job. It clears
  // when the TDR is complete, an explicit resolve is logged, or it ages out (21d).
  try {
    await crud.logEvent('tdr_info_requested', {
      job_id: jobId, technician_id: techId, requested_by: String(b.requested_by || 'office'),
      note, missing, at_ms: Date.now(),
    });
  } catch (_) {}
  return j(200, { ok: sent, technician_id: techId, customer, missing, note, red_box: true });
};

function j(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
