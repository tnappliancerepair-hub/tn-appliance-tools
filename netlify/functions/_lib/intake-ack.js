// intake-ack — the "we got your video, here's what's next, when are you free?"
// text that fires the moment a customer FINISHES intake (video + info landed
// clean). Before this, a customer who uploaded successfully heard nothing back
// and was left hanging after sending a video (Teddy 7/3) — so they'd call to
// ask "did you get it? / when am I scheduled?" This closes the intake->schedule
// loop with no human: confirms receipt, sets the next step, and collects their
// availability so the office can book straight from the reply.
//
// SAFE: guardedSend (opt-out absolute, quiet-hours/caps), one text per job
// (dedupe marker), and only fires when we DIDN'T already text them a
// finish-upload / on-the-schedule message (no double-text).
'use strict';

const guard = require('./sms-guard');
const crud = require('./xano/metadata-crud');

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

async function alreadyAcked(jobId) {
  if (!jobId) return false;
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'intake_ack_sent' }, { id: 'desc' }, 800);
    return rows.some((r) => String(metaOf(r).job_id || '') === String(jobId));
  } catch (_) { return false; }
}

function ackMessage(name, appliance, hasAvailability) {
  const who = String(name || '').trim().split(/\s+/)[0] || 'there';
  const what = String(appliance || 'appliance').toLowerCase();
  if (hasAvailability) {
    return `Hi ${who}, it's Tennessee Appliance — got your video and details on your ${what}, thank you! We're reviewing it now and we'll be in touch to get you scheduled. If your availability changes, just reply right here. Talk soon!`;
  }
  return `Hi ${who}, it's Tennessee Appliance — got your video and details on your ${what}, thank you! We're reviewing it now and we'll reach out to get you scheduled. To speed that up: what days and times work best for you, and are there any that DON'T? Just reply right here and we'll lock it in. Thanks!`;
}

// Fire the intake confirmation for one job. Returns { ok, reason }.
//   { job_id, phone, name, appliance, availability, consent, suppressed }
// suppressed = true when the caller already texted the customer (finish-upload /
// on-the-schedule) so we don't double-text.
async function sendIntakeAck({ job_id, phone, name, appliance, availability, consent, suppressed }) {
  if (suppressed) return { ok: false, reason: 'suppressed_already_texted' };
  const yes = (v) => v === true || String(v) === 'yes' || String(v) === 'true';
  if (!yes(consent)) return { ok: false, reason: 'no_consent' };
  if (!phone) return { ok: false, reason: 'no_phone' };
  if (await alreadyAcked(job_id)) return { ok: false, reason: 'already_acked' };

  const hasAvail = !!String(availability || '').trim();
  const message = ackMessage(name, appliance, hasAvail);
  // NOT allowQuiet — an intake ack is not time-sensitive, so it must respect
  // quiet hours. A ServicePower dispatch landing at 3am was firing this text at
  // 3:30am (real complaint, Teddy 2026-07-06). The guard now defers it to daytime.
  const res = await guard.guardedSend({ phone, message, tag: 'intake_ack', kind: 'intake_ack', allowQuiet: false });
  if (res.sent) {
    try { await crud.logEvent('intake_ack_sent', { job_id, phone: guard.toE164(phone), appliance: String(appliance || ''), had_availability: hasAvail, at_ms: Date.now() }); } catch (_) {}
  }
  return { ok: res.sent, reason: res.reason };
}

module.exports = { sendIntakeAck, ackMessage };
