// One-time onboarding text to Danielle: the 5 things every job needs in Ant so
// the phones stop getting confused. Scheduled each morning but SENDS ONCE
// (dedup) — so it lands the next morning she starts, then never repeats.

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const { sendSms } = require('./_lib/sms');
const DANIELLE = '+16154850713';

const MESSAGE =
  "Hey Danielle — quick one that'll make the phones SO much easier. Ant answers customer + warranty calls by looking in our Ant system. If the info's there, Ant handles the call. If it's not, Ant gets stuck and forwards it. So the more we keep these in Ant on each job, the more calls Ant just handles for us:\n\n" +
  "For every job, in Ant:\n" +
  "1) It's scheduled in Ant — the day + which tech (answers \"am I on the schedule? when are you coming?\")\n" +
  "2) The customer's phone number on the job (so Ant finds them when they call)\n" +
  "3) The claim / work-order number on the job (so when AHS or the warranty company calls, Ant pulls it right up)\n" +
  "4) Parts: ordered + the ETA date when you order them (answers \"where's my part? when's it in?\" — big one)\n" +
  "5) Status kept current — scheduled, waiting on parts, or completed (answers \"have you been out? what's going on with my claim?\")\n\n" +
  "If those five live in Ant, Ant can answer almost every call — no more confusion, no more \"let me forward you.\" Do it from the schedule screen, or just text/talk to me (\"schedule the Carson job with Jimmy Thursday,\" \"Davis job parts ordered, ETA next Friday\") and I'll log it. Every job you move over from HCP makes the phone smarter. I've got you. 🐜";

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function ctHour() {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(new Date()), 10);
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  const force = ((event.queryStringParameters || {}).force === '1');
  const hour = ctHour();
  if (!force && (hour < 5 || hour > 11)) return jsonResp(200, { ok: true, skipped: 'outside_morning', hour });
  try {
    if (!force) {
      const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ search: { action: 'ant_onboard_danielle_sent' }, per_page: 1, page: 1 }),
      });
      if (r.ok) { const d = await r.json(); if (((d && d.items) || []).length) return jsonResp(200, { ok: true, already_sent: true }); }
    }
    const sent = await sendSms(DANIELLE, MESSAGE, 'warranty_handler', 'ant_onboard_danielle');
    await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ action: 'ant_onboard_danielle_sent', metadata: { sent, at_ms: Date.now() } }),
    });
    return jsonResp(200, { ok: sent, sent });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message });
  }
};
