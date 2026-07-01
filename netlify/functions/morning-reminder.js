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
  '2026-07-02': "Good morning 🐜 — 🛻 CYBERTRUCK / write-off checklist (goal: a few before Dec 31):\n1) 📞 CPA call — ask 3 things: (a) current-year BONUS DEPRECIATION %, (b) does the Cybertruck's ~6-ft bed SKIP the SUV cap so it's FULLY deductible, (c) how a big write-off interacts with the S-CORP decision.\n2) 🏢 Title/register each truck to TN Appliance Exchange LLC (not personal) + keep a mileage log — proves >50% business use, the one thing the IRS wants.\n3) ⏰ Must take DELIVERY by Dec 31 to write it off THIS year — Cybertruck lead time is weeks, so ORDER EARLY. $69k AWD deal ≈ ~$48k net after the write-off; finance it and keep your cash.\n4) 🔢 Tell Claude your rough NET PROFIT this year so we size how many (Andre + Jimmy = 2 clean ones; don't buy more deduction than the profit can absorb).\n— Still open: RingCentral cancel (acct 31671095), Danielle invoice-loop test, flip DUPE_AUTO_MERGE_ENABLED=true.",
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
