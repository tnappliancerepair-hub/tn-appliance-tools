// Danielle's daily "good morning" from Ant — one text to start her day with
// what needs her: jobs to schedule, parts arrived (ready to rebook), on-hold,
// callbacks. Standing daily ~7:30am CT (netlify.toml "30 12 * * *").

'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const { sendSms } = require('./_lib/sms');
const DANIELLE = '+16154850713';

function ctHour() {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(new Date()), 10);
}

exports.handler = async () => {
  const hour = ctHour();
  if (hour < 5 || hour > 10) return jsonResp(200, { ok: true, skipped: 'outside_morning', hour });

  let toSchedule = 0, parts = 0, held = 0, callbacks = 0, stale = 0, schedFix = 0;
  try {
    const r = await fetch(`${XANO}/list_needs_scheduled_parallel?limit=1000`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    toSchedule = ((d && (d.items || d.jobs)) || []).length;
  } catch (_) {}
  try {
    const r = await fetch(`${XANO}/get_office_todo`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    const c = (d && d.counts) || {};
    parts = c.parts_arrived || 0; held = c.held || 0; callbacks = c.callbacks || 0; stale = c.stale_intake || 0;
  } catch (_) {}
  // Schedule Health — jobs whose time/tech is wrong (placeholder, no day, double-book,
  // past-not-done). Keeping this clean is what makes the day's automations trustworthy.
  try {
    const r = await fetch('https://tnapplianceexchange.net/.netlify/functions/schedule-sanity?key=tn-schedule-2026', { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    schedFix = (d && d.total) || 0;
  } catch (_) {}

  const bits = [];
  if (toSchedule) bits.push(toSchedule + ' to schedule');
  if (parts) bits.push(parts + ' with parts in (ready to rebook)');
  if (held) bits.push(held + ' on hold');
  if (callbacks) bits.push(callbacks + ' callback' + (callbacks === 1 ? '' : 's'));
  if (stale) bits.push(stale + ' stuck at intake');

  const summary = bits.length ? ('here\'s your day: ' + bits.join(', ') + '.') : 'you\'re all caught up — nothing urgent waiting. 🎉';
  const schedLine = schedFix
    ? ' 🗓️ Schedule Check: ' + schedFix + ' job' + (schedFix === 1 ? '' : 's') + ' need a real day/tech before they\'ll show on the schedule → tnapplianceexchange.net/schedule-sanity.html'
    : '';
  const body =
    'morning Danielle 🐜 — ' + summary + schedLine +
    ' Start here: tnapplianceexchange.net/needs-scheduled.html' +
    ' — and remember, you can just text or talk to me anytime to schedule a job, mark parts in, or ask a question. 💛';

  const sent = await sendSms(DANIELLE, body, 'warranty_handler', 'office_morning_briefing');
  return jsonResp(200, { ok: true, sent, counts: { toSchedule, parts, held, callbacks, stale } });
};

function jsonResp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}
