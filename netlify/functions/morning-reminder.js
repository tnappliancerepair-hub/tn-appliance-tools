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
  '2026-07-01': "Good morning 🐜 — today's list:\n1) ⏰ Cancel RINGCENTRAL before the 2nd to dodge next month's charge (acct 31671095) — saves $300/mo. Then watch the card to confirm it drops.\n2) 🧾 Have Danielle TEST the invoice loop end-to-end: log an invoice on a job → confirm it shows on the board tile AND the tech's app (his cut + paid/waiting status) → send a Stripe pay link to herself. Proves it before HCP shuts off the 18th.\n3) 🗑️ Dupe auto-merge is shadow-running — review the 'dupe_auto_merge_shadow' log, then flip DUPE_AUTO_MERGE_ENABLED=true to end Danielle's ~22/day delete chore.\n4) Still open: Lee/Jimmy profiles → auto-assign.",
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
