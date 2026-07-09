// frontdoor-push-status — INBOUND push (Ant -> Frontdoor): send a dispatch status
// update (+ optional note) into Frontdoor's Status API. This is the "kills Danielle's
// manual portal updating" side — the job lifecycle (on-my-way / arrived / complete /
// parts / notes) calls this and the update lands in Frontdoor automatically.
//
//   POST {
//     secret,                        // VAPI_ADMIN_SECRET (or the loop/office caller)
//     dispatch_number,               // Frontdoor dispatch id (required)
//     status_key,                    // e.g. "EN_ROUTE" | "ARRIVED" | "COMPLETE" (see _lib/frontdoor STATUS)
//     status_code?, description?,    // OR pass an explicit code + description
//     note?,                         // optional note text
//     area? | vendor_id?,            // which vendor account to push under (else default)
//     tenant?                        // AHS | HSA | FTDR | 2-10 (default AHS)
//   }
//
// SAFETY — SHADOW by default. Until vault FRONTDOOR_PUSH_LIVE = '1' AND the sandbox key
// is authorized (isConfigured), this only LOGS what it WOULD push (event_log
// 'frontdoor_push_shadow'). That way we can wire it into the lifecycle now and validate
// the exact payloads before a single real write leaves our system. Blocked live anyway
// by the 403 until Brian authorizes the Client ID.
'use strict';

const { getSecret } = require('./_lib/secrets');
const fd = require('./_lib/frontdoor');

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
async function logEvent(action, metadata) {
  const t = process.env.XANO_METADATA_TOKEN; if (!t) return;
  try {
    await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, metadata }),
    });
  } catch (_) {}
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'Method Not Allowed' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid JSON' }); }

  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (b.secret !== guard) return j(403, { ok: false, error: 'forbidden' });

  const dispatchNumber = String(b.dispatch_number || '').trim();
  if (!dispatchNumber) return j(400, { ok: false, error: 'dispatch_number required' });

  // Resolve the status code + description: prefer an explicit code, else a STATUS key.
  let statusCode = b.status_code, description = b.description || '';
  if (statusCode == null && b.status_key) {
    const s = fd.STATUS[String(b.status_key).toUpperCase()];
    if (!s) return j(400, { ok: false, error: 'unknown status_key; pass status_code+description' });
    statusCode = s.code; description = description || s.description;
  }
  if (statusCode == null) return j(400, { ok: false, error: 'status_key or status_code required' });

  // Which vendor account do we push under? explicit vendor_id > area lookup > default.
  const vendorId = String(b.vendor_id || (b.area ? fd.vendorForArea(b.area) : '') || '').trim();
  const tenant = String(b.tenant || 'AHS').trim();
  const note = String(b.note || '').trim();

  const pushLive = (await getSecret('FRONTDOOR_PUSH_LIVE')) === '1';
  const configured = await fd.isConfigured();
  const payloadPreview = { dispatch_id: Number(dispatchNumber), status_code: Number(statusCode), description, note, vendor_id: vendorId, tenant };

  // SHADOW: log what we would send, send nothing.
  if (!pushLive || !configured) {
    await logEvent('frontdoor_push_shadow', { ...payloadPreview, reason: !configured ? 'key_not_configured' : 'push_not_live', at_ms: Date.now() });
    return j(200, { ok: true, mode: 'shadow', would_push: payloadPreview, note: !configured ? 'sandbox key not authorized yet' : 'FRONTDOOR_PUSH_LIVE not set' });
  }

  // LIVE: push into Frontdoor.
  try {
    const resp = await fd.dispatchStatusUpdate({
      dispatchId: dispatchNumber, statusCode, description, note, vendorId, tenant,
    });
    await logEvent('frontdoor_push_sent', { ...payloadPreview, at_ms: Date.now() });
    return j(200, { ok: true, mode: 'live', pushed: payloadPreview, response: resp });
  } catch (e) {
    await logEvent('frontdoor_push_error', { ...payloadPreview, error: String((e && e.message) || e).slice(0, 200), at_ms: Date.now() });
    return j(200, { ok: false, mode: 'live', error: String((e && e.message) || e).slice(0, 200) });
  }
};
