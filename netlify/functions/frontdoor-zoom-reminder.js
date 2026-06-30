// frontdoor-zoom-reminder — one-off, self-expiring reminder for Teddy's Frontdoor
// partner-API Zoom with Ben Kelly: Thursday, July 9 2026, 9:30–10:15 AM CT.
// (Teddy asked "add this to my schedule" with the Ben Kelly text screenshot.)
//
// Date-gated like tech-morning-mirror-and-encourage.js — fires a day-before
// heads-up on 2026-07-08 and a morning-of reminder on 2026-07-09, then no-ops
// forever. Texts Teddy's own cell (owner bypasses the customer gate). Safe to
// leave scheduled; it self-expires.
//
//   GET ?dryrun=1   → show what it WOULD send, send nothing
'use strict';
const { sendSms } = require('./_lib/sms');

const TEDDY = '+16154855795';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// today's date in America/Chicago as YYYY-MM-DD
function ctDate() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // en-CA gives YYYY-MM-DD
}

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dryrun === '1';
  const today = ctDate();

  let msg = null;
  if (today === '2026-07-08') {
    msg = "Reminder: tomorrow (Thu Jul 9) you've got the Frontdoor Zoom with Ben Kelly, 9:30–10:15 AM CT. The setup email is in tnappliancerepair@gmail.com.";
  } else if (today === '2026-07-09') {
    msg = "Today 9:30–10:15 AM CT: Frontdoor Zoom with Ben Kelly. Join link is in the email Ben sent to tnappliancerepair@gmail.com.";
  }

  if (!msg) return j(200, { ok: true, today, sent: false, note: 'not a reminder day — no-op' });
  if (dry) return j(200, { ok: true, today, sent: false, dryrun: true, would_send: msg });

  const ok = await sendSms(TEDDY, msg, 'owner', 'frontdoor_zoom_reminder');
  try {
    await fetch(`${XANO}/record_event_log`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'frontdoor_zoom_reminder_sent', metadata: JSON.stringify({ today, ok }) }),
    });
  } catch (_) {}
  return j(200, { ok: true, today, sent: ok, msg });
};
