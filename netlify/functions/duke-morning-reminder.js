// duke-morning-reminder — one-off morning reminder (Teddy 2026-07-01): text
// Jimmy on the morning of his 9am Duke Towe job (7/2) to text the customer
// 30 min before he heads out. Date-gated so it only fires that morning, then
// self-noops. Scheduled ~7:12am CT in netlify.toml. Idempotent (one send).
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const crud = require('./_lib/xano/metadata-crud');

const FIRE_DATE_CT = '2026-07-02';         // only act this morning
const JIMMY = '6159671304';
const MSG = 'Morning Jimmy 🐜 — reminder: your 9am first stop is Duke Towe (fridge). '
  + 'He wants a text 30 MINUTES before you arrive, so tap "On My Way" about 30 min before you head out. Thanks!';

function ctDate() {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
  catch (_) { return ''; }
}

exports.config = { schedule: '12 12 * * *' }; // 12:12 UTC = 7:12am CDT

exports.handler = async function () {
  const today = ctDate();
  if (today !== FIRE_DATE_CT) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'not the fire date', today }) };

  // Idempotency: don't send twice.
  try {
    const seen = await crud.searchPage(crud.TABLES.event_log, { action: 'duke_morning_reminder_sent' }, { id: 'desc' }, 5);
    if (seen && seen.length) return { statusCode: 200, body: JSON.stringify({ ok: true, already: true }) };
  } catch (_) {}

  let sent = false, err = null;
  try {
    const r = await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '+1' + JIMMY, message: MSG, context_tag: 'duke_morning_reminder' }),
      signal: AbortSignal.timeout(12000),
    });
    sent = r.ok;
  } catch (e) { err = String(e.message || e); }
  try { await crud.logEvent('duke_morning_reminder_sent', { to: JIMMY, sent, at_ms: Date.now() }); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent, err }) };
};
