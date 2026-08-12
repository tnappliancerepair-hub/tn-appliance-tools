// telnyx-failover-watch — tell Teddy when the Twilio backup kicks in (Teddy 2026-08-12:
// "if we have any issues we should use it as a backup but I need to know so I can fix it").
//
// send_sms now auto-fails-over to Twilio when a primary Telnyx send fails, logging an
// `sms_telnyx_failover` event each time (no message lost). This sweep watches for those
// events and texts Teddy a single, throttled heads-up so he can go fix the Telnyx line —
// without spamming him once per failed text during an outage.
//
// The alert itself goes through sendSms, which will ALSO auto-failover to Twilio, so Teddy
// still gets it even while Telnyx is down.
//
// Scheduled every ~10 min (403 on manual curl is normal). Manual: ?secret=<admin> · ?dry=1.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');

const OWNER = '+16154855795';        // Teddy
const WINDOW_MS = 20 * 60000;        // look at failovers in the last 20 min
const DEDUPE_MS = 60 * 60000;        // at most one alert per hour
const SCAN = 60;

function j(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function metaOf(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  const dry = q.dry === '1';

  const now = Date.now();

  // Recent failover events
  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_telnyx_failover' }, { created_at: 'desc' }, SCAN); } catch (_) { rows = []; }
  rows = Array.isArray(rows) ? rows : (rows && rows.items) || [];
  const recent = rows.filter((r) => Number(r.created_at || 0) >= now - WINDOW_MS);

  if (!recent.length) return j(200, { ok: true, failovers: 0, alerted: false });

  // Already alerted in the last hour? (throttle — one ping per incident, not per text)
  let last = null;
  try { last = await crud.searchOne(crud.TABLES.event_log, { action: 'telnyx_failover_alerted' }, { id: 'desc' }); } catch (_) {}
  if (last && Number(last.created_at || 0) >= now - DEDUPE_MS) {
    return j(200, { ok: true, failovers: recent.length, alerted: false, reason: 'throttled' });
  }

  // Break down what failed (customer vs internal) for a useful message.
  let cust = 0, intl = 0, lastErr = '';
  for (const r of recent) {
    const m = metaOf(r);
    if (m.recipient_class === 'customer') cust++; else intl++;
    if (m.telnyx_error) lastErr = String(m.telnyx_error);
  }
  const msg = '⚠️ Telnyx SMS trouble — ' + recent.length + ' text(s) fell back to the Twilio backup in the last 20 min ('
    + cust + ' customer, ' + intl + ' internal). Messages STILL went out. Check the Telnyx numbers/line.'
    + (lastErr ? ' Last error: ' + lastErr.slice(0, 80) : '');

  if (!dry) {
    try { await sendSms(OWNER, msg, 'owner', 'telnyx_failover_alert'); } catch (_) {}
    try { await crud.logEvent('telnyx_failover_alerted', { count: recent.length, customer: cust, internal: intl, last_error: lastErr, at_ms: now }); } catch (_) {}
  }

  return j(200, { ok: true, failovers: recent.length, customer: cust, internal: intl, alerted: !dry, message: msg });
};
