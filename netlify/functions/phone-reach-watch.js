// phone-reach-watch — catch "nobody is set to receive calls" before Teddy notices he
// hasn't gotten a call all day. The Reach Me toggle silently reverted to OFF on
// 2026-07-16 (a save that didn't persist) → every "talk to a human" forward hit a ring
// group that dialed no one, and Teddy got ZERO calls for hours without knowing why.
// This watchdog checks, during business hours, whether BOTH office reach switches are
// off; if so it texts Teddy so the dead-transfer state can never go unnoticed again.
//
//   scheduled (netlify.toml) · manual: ?secret=VAPI_ADMIN_SECRET[&dryrun=1]
'use strict';

const { getSecretFresh } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const OWNER = '+16154855795';
const DEDUP_MIN = 120;       // don't re-alert for 2h
const OPEN_HOUR = 8;         // 8am CT
const CLOSE_HOUR = 18;       // 6pm CT
const SITE = 'https://tnapplianceexchange.net';

function ctHour() { try { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10); } catch (_) { return 12; } }
function ctDow() { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date()); } catch (_) { return 'Mon'; } }
function isOff(v) { return String(v || '').trim().toLowerCase() === 'off'; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled) {
    const guard = (await getSecretFresh('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== guard) return j(403, { ok: false, error: 'forbidden' });
  }
  const dry = q.dryrun === '1';
  const force = q.force === '1';

  // Business hours only (Mon–Fri, 8am–6pm CT) unless forced — a dead transfer at
  // 2am is expected (Ant takes a message).
  const h = ctHour(), dow = ctDow();
  const businessHours = h >= OPEN_HOUR && h < CLOSE_HOUR && !['Sat', 'Sun'].includes(dow);
  if (!businessHours && !force) return j(200, { ok: true, skipped: 'after_hours', hour: h, dow });

  const teddyOn = !isOff(await getSecretFresh('OFFICE_REACH_TEDDY'));
  const danielleOn = !isOff(await getSecretFresh('OFFICE_REACH_DANIELLE'));
  if (teddyOn || danielleOn) return j(200, { ok: true, teddyOn, danielleOn, alert: false });

  // Both off during business hours — dead transfer. Dedup so it doesn't nag.
  let alerted = [];
  try { alerted = await crud.searchPage(3, { action: 'phone_reach_alerted' }, { created_at: 'desc' }, 20); } catch (_) {}
  const cut = Date.now() - DEDUP_MIN * 60000;
  const recent = alerted.some(r => { const m = meta(r); const w = Number(m.at_ms) || (r.created_at ? Date.parse(r.created_at) : 0); return w >= cut; });
  if (recent && !force) return j(200, { ok: true, teddyOn, danielleOn, alert: true, skipped: 'deduped' });

  const body = `⚠️ Ant: nobody is set to receive office calls right now — both Reach Me switches are OFF during business hours, so "talk to a human" calls ring no one. Turn yours back on: ${SITE}/office-reach.html`;
  if (!dry) {
    try { await sendSms(OWNER, body, 'owner', 'phone_reach_alert'); } catch (_) {}
    try { await crud.logEvent('phone_reach_alerted', { teddyOn, danielleOn, hour: h, dow, at_ms: Date.now() }); } catch (_) {}
  }
  return j(200, { ok: true, teddyOn, danielleOn, alert: true, texted: !dry });
};
