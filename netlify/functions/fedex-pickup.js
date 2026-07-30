// fedex-pickup — office-gated FedEx pickup scheduling for the returns pile.
//   GET  ?action=availability&date=YYYY-MM-DD           -> available windows/carriers
//   POST {action:'schedule', date, readyTime?, closeTime?, packageCount, weightLbs?}
//   POST {action:'cancel', confirmationNumber, date}
// Auth: office password (X-Office-Pw / ?pw=) OR admin ?secret=. Returns a friendly
// not_configured until FedEx creds are in the vault.
'use strict';
const fedex = require('./_lib/fedex');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
async function authed(event, q, b) {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if ((q.secret || b.secret) === admin) return true;
  const pw = q.pw || b.pw || (event.headers && (event.headers['x-office-pw'] || event.headers['X-Office-Pw']));
  if (!pw) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }), signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    return !!(d && (d.success || d.valid || d.ok));
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Office-Pw' }, body: '' };
  const q = event.queryStringParameters || {};
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  if (!(await authed(event, q, b))) return json(401, { ok: false, error: 'unauthorized' });

  if (!(await fedex.configured())) return json(200, { ok: false, configured: false, error: 'FedEx not connected yet — add FEDEX_CLIENT_ID + FEDEX_CLIENT_SECRET (+ FEDEX_ACCOUNT_NUMBER) in the vault.' });

  const action = String(q.action || b.action || 'availability').toLowerCase();
  try {
    if (action === 'availability') {
      const r = await fedex.pickupAvailability({ date: q.date || b.date, readyTime: b.readyTime, closeTime: b.closeTime });
      return json(200, { ok: r.ok, configured: true, action, result: r.data, status: r.status });
    }
    if (action === 'schedule') {
      const r = await fedex.schedulePickup({ date: b.date, readyTime: b.readyTime, closeTime: b.closeTime, packageCount: b.packageCount, weightLbs: b.weightLbs, remarks: b.remarks });
      const conf = r.data && (r.data.output && (r.data.output.pickupConfirmationCode || r.data.output.confirmationNumber));
      if (r.ok) { try { await crud.logEvent('fedex_pickup_scheduled', { date: b.date, packages: b.packageCount, confirmation: conf, actor: b.actor || 'office', at_ms: Date.now() }); } catch (_) {} }
      return json(200, { ok: r.ok, configured: true, action, confirmation: conf || null, result: r.data, status: r.status });
    }
    if (action === 'cancel') {
      const r = await fedex.cancelPickup({ confirmationNumber: b.confirmationNumber, scheduledDate: b.date });
      if (r.ok) { try { await crud.logEvent('fedex_pickup_cancelled', { confirmation: b.confirmationNumber, actor: b.actor || 'office', at_ms: Date.now() }); } catch (_) {} }
      return json(200, { ok: r.ok, configured: true, action, result: r.data, status: r.status });
    }
    return json(400, { ok: false, error: 'unknown action (availability|schedule|cancel)' });
  } catch (e) {
    return json(200, { ok: false, configured: true, error: String((e && e.message) || e) });
  }
};
