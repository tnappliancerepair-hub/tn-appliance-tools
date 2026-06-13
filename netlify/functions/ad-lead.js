// Booking funnel behind the Cybertruck QR (truck.html): captures a $50 quick-check
// request, logs it tagged by source (ROI tracking), and texts the office so a
// real person follows up fast. No free diagnosis — the offer is the paid check.
//
// POST { mode:'scan'|'book', src, name, phone, zip, appliance, problem }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const { sendSms } = require('./_lib/sms');
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
async function logRow(action, metadata) {
  const h = headers(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action, metadata }) }); } catch (_) {}
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return jsonResp(400, { ok: false, error: 'invalid_json' }); }
  const src = String(b.src || 'web').slice(0, 40);

  if (b.mode === 'scan') {
    await logRow('ad_scan', { src, at_ms: Date.now() });
    return jsonResp(200, { ok: true, logged: 'scan' });
  }

  const name = String(b.name || '').slice(0, 80);
  const phone = String(b.phone || '').slice(0, 40);
  const zip = String(b.zip || '').slice(0, 12);
  const appliance = String(b.appliance || '').slice(0, 60);
  const problem = String(b.problem || '').slice(0, 600);
  if (!phone && !name) return jsonResp(400, { ok: false, error: 'name or phone required' });

  await logRow('quick_check_request', { src, name, phone, zip, appliance, problem, at_ms: Date.now() });

  // Alert the office so a human follows up fast (these are warm ad leads).
  const alert = '[ant] 🐜 new $50 quick-check request (' + src + '): ' +
    (name || '(no name)') + ' ' + (phone || '') + (zip ? (' · ' + zip) : '') +
    ' — ' + (appliance || 'appliance') + (problem ? (': ' + problem.slice(0, 120)) : '') + '. Call to book.';
  try { await sendSms(OWNER, alert, 'owner', 'quick_check_lead'); } catch (_) {}
  try { await sendSms(DANIELLE, alert, 'warranty_handler', 'quick_check_lead'); } catch (_) {}

  return jsonResp(200, { ok: true });
};
