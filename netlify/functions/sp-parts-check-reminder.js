// sp-parts-check-reminder — one-off Monday reminder (Teddy 2026-07-08): text Teddy on
// Monday to run the ServicePower parts check so we can wire the parts list straight from
// the API (the last piece of the SquareTrade parts-returns work). Date-gated so it only
// fires that Monday, then self-noops. Idempotent (one send). Scheduled ~8:07am CT.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const crud = require('./_lib/xano/metadata-crud');

const FIRE_DATE_CT = '2026-07-13';   // Monday — only act this morning
const TEDDY = '6154855795';          // owner (internal number → always delivers)
const MSG = 'Morning Teddy 🐜 — Monday reminder: run the ServicePower parts check when you get a minute. '
  + 'Open tnapplianceexchange.net/sp-parts-check.html, type a SquareTrade job number, tap Check, '
  + 'then just tell Claude that job number. That\'s the last piece to pull the parts list straight from '
  + 'ServicePower so we stop missing returns.';

function ctDate() {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
  catch (_) { return ''; }
}

exports.config = { schedule: '7 13 * * 1' }; // Mondays 13:07 UTC = 8:07am CDT

exports.handler = async function () {
  const today = ctDate();
  if (today !== FIRE_DATE_CT) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'not the fire date', today }) };

  // Idempotency: don't send twice.
  try {
    const seen = await crud.searchPage(crud.TABLES.event_log, { action: 'sp_parts_check_reminder_sent' }, { id: 'desc' }, 5);
    if (seen && seen.length) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true }) };
  } catch (_) {}

  let sent = false, err = null;
  try {
    const r = await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '+1' + TEDDY, message: MSG, context_tag: 'sp_parts_check_reminder' }),
      signal: AbortSignal.timeout(12000),
    });
    sent = r.ok;
  } catch (e) { err = String(e.message || e); }
  try { await crud.logEvent('sp_parts_check_reminder_sent', { to: TEDDY, sent, at_ms: Date.now() }); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent, err }) };
};
