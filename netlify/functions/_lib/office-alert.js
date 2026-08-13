// office-alert — route a delegated OFFICE/DISPATCH task alert to the schedulers (Danielle +
// Sofia) instead of the owner, and only during business hours (Teddy 2026-08-12: "those are
// tasks I've delegated — send them to Danielle and Sofia, only during business hours").
//
// Off-hours it silently no-ops: these tasks also live on the board/queues, so nothing is
// lost — the schedulers just aren't pinged after 6pm or on weekends.
'use strict';

const { sendSms } = require('./sms');

const SCHEDULERS = [
  { phone: '+16154850713', role: 'danielle' },   // Danielle
  { phone: '+16292594602', role: 'office' },      // Sofia
];

// Mon–Fri 9am–6pm America/Chicago.
function bizHoursCT() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
  const wd = (parts.find((p) => p.type === 'weekday') || {}).value || '';
  let hr = Number((parts.find((p) => p.type === 'hour') || {}).value); if (hr === 24) hr = 0;
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd) && hr >= 9 && hr < 18;
}

async function officeTaskAlert(message, tag) {
  if (!bizHoursCT()) return { sent: false, reason: 'off_hours' };
  const results = [];
  for (const r of SCHEDULERS) {
    try { results.push({ who: r.role, sent: !!(await sendSms(r.phone, message, r.role, tag || 'office_task')) }); }
    catch (_) { results.push({ who: r.role, sent: false }); }
  }
  return { sent: true, results };
}

module.exports = { officeTaskAlert, bizHoursCT, SCHEDULERS };
