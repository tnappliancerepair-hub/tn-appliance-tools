// human-line-inbound — inbound handler for the SHARED HUMAN line (615-757-5500).
//
// This is the HUMAN lane, completely separate from the AI line (588-9500). A
// customer texts here and it's recorded to the per-job thread (the same
// inbound_customer_sms_received rows sms-thread.js reads by phone), so the office
// job tile, the tech's job page, and the customer portal all see it. There is NO
// AI here — no auto-reply, no bot. Humans (office + tech) respond. Only STOP/START
// is handled, for TCPA compliance. (Teddy 2026-07-14 — two-lane separation.)
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const guard = require('./_lib/sms-guard');
const dlr = require('./_lib/sms-dlr');

const HUMAN_LINE = '+16158578800'; // the approved human line (switched from 757-5500, 2026-07-16)
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

// Telnyx v2 inbound webhook shape: { data: { event_type, payload: { from:{phone_number}, to:[{phone_number}], text } } }
function parseInbound(event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = (b.data && b.data.payload) || b.payload || {};
  const from = (p.from && p.from.phone_number) || p.from || '';
  const toArr = p.to || [];
  const to = Array.isArray(toArr) ? ((toArr[0] && toArr[0].phone_number) || '') : ((toArr && toArr.phone_number) || toArr || '');
  const text = p.text || p.body || '';
  const evType = (b.data && b.data.event_type) || b.event_type || '';
  return { from, to, text, evType };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(200, { ok: true, note: 'human-line inbound handler' });
  // Outbound delivery receipt? Record any FAILURE (so sms-delivery-watch can catch the
  // line going dark) and stop — it's not an inbound message.
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const d = await dlr.recordIfDeliveryFailure(body);
  if (d.isDlr) return json(200, { ok: true, dlr: true, failed: d.failed });
  const { from, to, text, evType } = parseInbound(event);
  // Ignore any other non-inbound events.
  if (evType && !/received|inbound/i.test(evType)) return json(200, { ok: true, ignored: evType });
  if (!from) return json(200, { ok: true, note: 'no from number' });

  // TCPA: honor STOP / START (the only automated thing this lane ever does).
  try {
    if (guard.isStop(text)) { await guard.recordOptOut(from, 'human_line'); }
    else if (guard.isStart(text)) { await guard.clearOptOut(from, 'human_line'); }
  } catch (_) {}

  // Record to the shared per-job thread. sms-thread.js matches these by the
  // customer's phone, so this lands on every surface (office tile, tech page,
  // customer portal). lane:'human' marks which lane it belongs to.
  try {
    await crud.logEvent('inbound_customer_sms_received', {
      phone: from, from, to: to || HUMAN_LINE, body: text, message: text,
      source: 'human_line', lane: 'human', at_ms: Date.now(),
    });
  } catch (_) {}

  // NO AI. A human answers from the shared office inbox / tech page. Done.
  return json(200, { ok: true, recorded: true, lane: 'human' });
};
