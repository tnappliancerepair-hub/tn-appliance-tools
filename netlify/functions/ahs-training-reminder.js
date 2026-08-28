// ahs-training-reminder — one-off morning reminder (Teddy 2026-08-21): text Teddy
// the morning of his AHS Appliance Upgrade contractor training (Fri Aug 28, 8:00 AM CT)
// with the Teams join link, so he can jump on even if he's in the field. Date-gated so
// it only fires that morning, then self-noops forever. Scheduled ~7:22am CT in
// netlify.toml. Idempotent (one send). Texts Teddy's cell (internal → bypasses the gate).
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const crud = require('./_lib/xano/metadata-crud');

const FIRE_DATE_CT = '2026-08-28';         // only act this morning
const TEDDY = '6154855795';                // owner cell — internal, sends straight through
const MSG = 'Morning Teddy 🐜 — reminder: your AHS Appliance Upgrade training with Brett Foley '
  + 'is at 8:00 AM CT (about 40 min out). It runs 1 hour — you only need this one session.\n\n'
  + 'Join Teams: https://teams.microsoft.com/meet/256041148161367?p=HK2l2uOR61GU0vkQoB\n'
  + 'Passcode: eg7Xd7BZ  ·  Dial-in: +1 469-208-1511,,417484885#';

function ctDate() {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
  catch (_) { return ''; }
}

exports.config = { schedule: '22 12 * * *' }; // 12:22 UTC = 7:22am CDT (Aug = daylight)

exports.handler = async function () {
  const today = ctDate();
  if (today !== FIRE_DATE_CT) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'not the fire date', today }) };

  // Idempotency: don't send twice.
  try {
    const seen = await crud.searchPage(crud.TABLES.event_log, { action: 'ahs_training_reminder_sent' }, { id: 'desc' }, 5);
    if (seen && seen.length) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true }) };
  } catch (_) {}

  let sent = false, err = null;
  if (require('./_lib/office-gate').officeBlocked('+1' + TEDDY, 'ahs_training_reminder')) { return { statusCode: 200, body: JSON.stringify({ ok: true, sent: false, suppressed: true }) }; } // 🔇 office kill
  try {
    const r = await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '+1' + TEDDY, message: MSG, context_tag: 'ahs_training_reminder' }),
      signal: AbortSignal.timeout(12000),
    });
    sent = r.ok;
  } catch (e) { err = String(e.message || e); }
  try { await crud.logEvent('ahs_training_reminder_sent', { to: TEDDY, sent, at_ms: Date.now() }); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent, err }) };
};
