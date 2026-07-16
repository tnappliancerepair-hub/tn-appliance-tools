// sms-dlr — detect + record an OUTBOUND delivery FAILURE from a Telnyx message-status
// webhook. Telnyx delivers these (message.sent / message.finalized, with a per-recipient
// status) to the SAME messaging-profile webhook as inbound messages, so the inbound
// handlers already receive them — they just used to discard them. Capturing the FAILURES
// is what lets sms-delivery-watch catch a customer line going dark (e.g. the 10DLC-drop
// on 2026-07-16, where Telnyx accepted every text but carriers silently dropped them).
'use strict';

const crud = require('./xano/metadata-crud');

// Returns { isDlr, failed }. isDlr=true means this was an outbound status event (the
// caller should stop — it's not an inbound message). Never throws.
async function recordIfDeliveryFailure(body) {
  try {
    const d = (body && body.data) || body || {};
    const ev = String(d.event_type || d.eventType || '').toLowerCase();
    const p = d.payload || {};
    const dir = String(p.direction || '').toLowerCase();
    // An outbound status event: direction=outbound, or a sent/finalized/delivery event type.
    const isOutbound = dir === 'outbound'
      || /message\.(sent|finalized|delivery)/.test(ev)
      || /delivery[_.-]?(failed|receipt)|sending[_.-]?failed/.test(ev);
    if (!isOutbound) return { isDlr: false, failed: false };

    const from = (p.from && p.from.phone_number) || p.from || '';
    const recips = Array.isArray(p.to) ? p.to : (p.to ? [p.to] : []);
    let failed = null;
    for (const r of recips) {
      const st = String((r && r.status) || '').toLowerCase();
      if (/fail|undeliv|reject|expired|blocked/.test(st)) { failed = { to: (r && (r.phone_number || r)) || '', status: st }; break; }
    }
    const errs = Array.isArray(p.errors) ? p.errors : [];
    if (!failed && errs.length) failed = { to: (recips[0] && (recips[0].phone_number || recips[0])) || '', status: 'error' };

    if (failed) {
      await crud.logEvent('sms_delivery_failed', {
        line: from, to: failed.to, status: failed.status,
        error: (errs[0] && ((errs[0].code || '') + ' ' + (errs[0].title || errs[0].detail || ''))).trim() || '',
        event_type: ev, at_ms: Date.now(),
      });
    }
    return { isDlr: true, failed: !!failed };
  } catch (_) { return { isDlr: false, failed: false }; }
}

module.exports = { recordIfDeliveryFailure };
