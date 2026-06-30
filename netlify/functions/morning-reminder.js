// morning-reminder — date-keyed "remind me tomorrow" board. Texts Teddy at 8 AM CT
// on any date that has an entry below, then no-ops. Add a line to REMINDERS to
// schedule one; it self-expires. (Teddy 2026-06-30: "remind me of this tomorrow.")
//
//   GET ?dryrun=1   → show today's reminder (if any), send nothing
'use strict';
const { sendSms } = require('./_lib/sms');
const TEDDY = '+16154855795';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }

// date (CT, YYYY-MM-DD) -> reminder text
const REMINDERS = {
  '2026-07-01': "Tomorrow project 🐜: the duplicate-job auto-merge is built and shadow-running (every 15 min, NOT canceling yet). Review the 'dupe_auto_merge_shadow' log entries to confirm it's only flagging real dupes, then flip DUPE_AUTO_MERGE_ENABLED=true in admin-secrets.html to go live — that ends Danielle's ~22/day delete chore. Also still open: Lee/Jimmy profiles → auto-assign, and the per-completion earnings display for the techs.",
};

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dryrun === '1';
  const today = ctDate();
  const msg = REMINDERS[today];
  if (!msg) return j(200, { ok: true, today, sent: false, note: 'no reminder for today' });
  if (dry) return j(200, { ok: true, today, sent: false, dryrun: true, would_send: msg });
  const ok = await sendSms(TEDDY, msg, 'owner', 'morning_reminder');
  try { await fetch(`${XANO}/record_event_log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'morning_reminder_sent', metadata: JSON.stringify({ today, ok }) }) }); } catch (_) {}
  return j(200, { ok: true, today, sent: ok });
};
