// scorecard-digest — the end-of-day truth text to the owner. At 6 PM Central,
// Mon–Fri, it pulls the Owner Scorecard (phones + office footprint, timestamped)
// and texts Teddy one glance: calls caught, callbacks cleared, schedules,
// invoices, texts, and Danielle's last-active time. This is the check she can't
// write herself — the record, not the self-report.
//
// Runs hourly and fires only at 6 PM CT on a weekday (DST-proof), once per day.
// Self-authorizes on {next_run}; manual: ?secret=  (add &force=1 to send now).
// Kill switch: vault SCORECARD_DIGEST=false.
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';
function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

function ctParts() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t) => (p.find((x) => x.type === t) || {}).value || '';
  return { wd: g('weekday'), hour: parseInt(g('hour') || '0', 10), dateStr: `${g('year')}-${g('month')}-${g('day')}` };
}
function fmtTime(ms) { return ms ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms)) : '—'; }
function agoH(ms) { if (!ms) return ''; const h = (Date.now() - ms) / 3600000; return h < 1 ? `${Math.round(h * 60)}m` : `${Math.round(h)}h`; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const off = String((await getSecretFresh('SCORECARD_DIGEST')) || '').trim().toLowerCase() === 'false';
  if (off) return json(200, { ok: true, disabled: true });

  const force = q.force === '1';
  const { wd, hour, dateStr } = ctParts();
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd);
  // 6 PM CT weekday only (unless forced). Hourly cron + this gate = DST-proof.
  if (!force && (!isWeekday || hour !== 18)) return json(200, { ok: true, skipped: 'not_6pm_ct_weekday', wd, hour });

  // Once per day
  if (!force) {
    const last = String((await getSecretFresh('SCORECARD_DIGEST_DATE')) || '').trim();
    if (last === dateStr) return json(200, { ok: true, skipped: 'already_sent_today' });
  }

  // Pull the scorecard (today's window)
  let sc = {};
  try {
    const r = await fetch(`${SITE}/.netlify/functions/office-scorecard?secret=${encodeURIComponent(admin)}&days=1`, { signal: AbortSignal.timeout(70000) });
    sc = await r.json().catch(() => ({}));
  } catch (e) { return json(200, { ok: false, error: 'scorecard_fetch_failed: ' + String(e.message || e) }); }

  const ph = sc.phone_today || {};
  const cb = sc.callbacks || {};
  const fp = sc.office_footprint || {};
  const cbLine = cb.ok
    ? (cb.open === 0 ? '📲 Callbacks: 0 open ✅' : `📲 Callbacks: ${cb.open} OPEN${cb.oldest_ms ? ` · oldest ${agoH(cb.oldest_ms)} ago` : ''} ⚠️`)
    : '📲 Callbacks: (couldn\'t read)';

  const lines = [
    `📊 Danielle — end of day (${wd})`,
    '',
    ph.ok ? `📞 Phones 24h: ${ph.total} calls · ${ph.transferred} sent to a person · ${ph.asked_human} asked for one · ${ph.dropped} dropped` : '📞 Phones: (couldn\'t read)',
    ph.ok && ph.arrival ? `   ⏱ ${ph.arrival} "when's he coming" calls` : '',
    cbLine,
    `🗓 Schedules: ${fp.schedules_saved || 0}  ·  🧾 Invoices: ${fp.invoices_logged || 0}`,
    `💬 Customer texts: ${fp.customer_texts || 0}  ·  📋 TDRs: ${fp.tdrs_filed || 0}`,
    `🕐 Last active in Ant: ${fmtTime(fp.last_active_ms)}`,
    '',
    `Full board: ${SITE}/office-scorecard.html`,
  ].filter((l) => l !== '');

  if (q.dry === '1') return json(200, { ok: true, dry: true, message: lines.join('\n') });

  try { await sendSms(OWNER, lines.join('\n'), 'owner', 'scorecard_digest'); } catch (e) { return json(200, { ok: false, error: 'sms_failed: ' + String(e.message || e) }); }
  if (!force) { try { await setSecret('SCORECARD_DIGEST_DATE', dateStr); } catch (_) {} }

  return json(200, { ok: true, sent: true, date: dateStr, forced: force });
};
