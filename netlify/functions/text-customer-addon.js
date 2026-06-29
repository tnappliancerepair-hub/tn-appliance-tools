// text-customer-addon — one-tap "confirm the add-on with the customer" from the
// office job drawer. Teddy (2026-06-29): people request add-ons (leak-detector kit,
// etc.); Danielle opens their job and clicks one button that texts them a simple,
// prewritten "you wanted it — want it? here's the price" message. Not the tech tool.
//
// The office builds + previews the message client-side (so she sees exactly what
// goes out); this just sends it to the customer + logs it. Respects the customer SMS
// gate (these are real customer texts).
//
//   POST { job_id, to, message }  ->  { ok }
'use strict';
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }
  const to = String(b.to || '').trim();
  const message = String(b.message || '').trim();
  const jobId = b.job_id || null;
  if (!to || !message) return json(400, { ok: false, error: 'to + message required' });

  const ok = await sendSms(to, message, 'customer', 'addon_confirm');
  if (ok) { try { await crud.logEvent('addon_customer_texted', { job_id: jobId, to, at_ms: Date.now() }); } catch (_) {} }
  return json(200, { ok: !!ok, error: ok ? undefined : 'send failed (customer SMS may be gated)' });
};
