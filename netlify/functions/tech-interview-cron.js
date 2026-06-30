// tech-interview-cron — places the "Ant — Tech Setup" interview calls to build
// each tech's self-scheduling profile. Teddy's order (2026-06-29 night):
//   "Make the call 8am. If no answer 9am."
// Wave 1 at 8:00 CT (13:00 UTC), Wave 2 (retry) at 9:00 CT (14:00 UTC). Only calls
// a tech who does NOT yet have a saved profile (get-tech-profile) — so anyone who
// answered + saved at 8am is skipped at 9am. DATE-LOCKED to 2026-06-30 so it can't
// keep calling the crew every morning forever. Manual: ?secret=&dryrun=1 (list) or
// ?secret=&force=1 (run a wave now regardless of clock/date).
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const ASSISTANT_ID = 'ec2be4b8-c1c4-4c68-a7ea-d44f7d63a3e6';
const RUN_DATE = '2026-06-30';           // only auto-fire on this CT date
const SITE = 'https://tnapplianceexchange.net';

// interview targets (6/28 self-scheduling list). Voice numbers (Andre = 504 cell).
const TECHS = [
  { tech_id: 1, name: 'Teddy', phone: '+16154855795' },
  { tech_id: 2, name: 'Jimmy', phone: '+16159671304' },
  { tech_id: 3, name: 'Andre', phone: '+15049099413' },
  { tech_id: 4, name: 'Lee',   phone: '+16158291654' },
  { tech_id: 6, name: 'John',  phone: '+18133527686' },
];

function ctParts() {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date())) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) };
}

async function hasProfile(techId) {
  try { const r = await fetch(`${SITE}/.netlify/functions/get-tech-profile?tech_id=${techId}`); const d = await r.json(); return !!(d && d.found); }
  catch (_) { return false; }
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const manual = q.dryrun === '1' || q.force === '1';
  if (manual && q.secret !== admin) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };

  const { date, hour } = ctParts();
  const scheduled = !manual;
  // auto: only on the locked date, only at the 8am/9am CT hours
  if (scheduled && (date !== RUN_DATE || (hour !== 8 && hour !== 9))) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'off-window', ct_date: date, ct_hour: hour }) };
  }
  const wave = hour === 9 ? '9am' : '8am';

  // who still needs a profile
  const pending = [];
  for (const t of TECHS) { if (!(await hasProfile(t.tech_id))) pending.push(t); }

  if (q.dryrun === '1') return { statusCode: 200, body: JSON.stringify({ ok: true, dryrun: true, wave, ct_date: date, ct_hour: hour, would_call: pending }, null, 2) };

  const results = [];
  for (const t of pending) {
    const url = `${SITE}/.netlify/functions/vapi-admin?secret=${encodeURIComponent(admin)}&action=interview_call`
      + `&to=${encodeURIComponent(t.phone)}&assistant_id=${ASSISTANT_ID}&tech_id=${t.tech_id}&tech_first=${encodeURIComponent(t.name)}`;
    let ok = false, callId = null, err = null;
    try { const r = await fetch(url); const d = await r.json(); ok = !!d.ok; callId = d.call_id || null; err = d.error || null; }
    catch (e) { err = String(e.message || e); }
    results.push({ tech_id: t.tech_id, name: t.name, ok, call_id: callId, error: err });
    try { await crud.logEvent('tech_interview_call_placed', { tech_id: t.tech_id, name: t.name, wave, ok, call_id: callId, at_ms: Date.now() }); } catch (_) {}
  }

  // tell Teddy the wave result
  try {
    const placed = results.filter((r) => r.ok).map((r) => r.name);
    const already = TECHS.filter((t) => !pending.find((p) => p.tech_id === t.tech_id)).map((t) => t.name);
    const { sendSms } = require('./_lib/sms');
    let msg = `🐜 Tech interviews — ${wave} wave: calling ${placed.length ? placed.join(', ') : '(none)'}.`;
    if (already.length) msg += ` Already saved: ${already.join(', ')}.`;
    if (wave === '8am' && pending.length) msg += ` Anyone who doesn't answer gets a retry at 9am.`;
    await sendSms('+16154855795', msg, 'owner', 'tech_interview_cron');
  } catch (_) {}

  return { statusCode: 200, body: JSON.stringify({ ok: true, wave, ct_date: date, ct_hour: hour, called: results.length, results }, null, 2) };
};
