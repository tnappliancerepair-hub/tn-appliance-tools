// sms-dlr — the OUTBOUND delivery receipt. Telnyx POSTs message.sent / message.finalized
// (with a per-recipient status) to the SAME messaging-profile webhook as inbound messages,
// so the inbound handlers have always received one for every text we've ever sent.
//
// It used to do exactly one thing: record FAILURES, so sms-delivery-watch could catch a
// customer line going dark (the 10DLC drop on 2026-07-16, where Telnyx accepted every text
// and carriers silently dropped them). The SUCCESS was thrown on the floor.
//
// Teddy, 2026-09-15: "we want to be able to see if the customers opened it."
// ⚠️ **"Opened" does not exist for SMS.** No carrier reports a read, and nothing here will
// ever claim one — CLAUDE.md has carried that rule since 09-14. What a carrier DOES tell us
// is that the handset received it, and that is what this now writes back onto the bubble:
// thread_message.delivery_status / delivered_at, matched on the carrier's message id
// (migration 076). Failure recording is unchanged.
'use strict';

const crud = require('./xano/metadata-crud');
const { getSecret } = require('./secrets');

// Stamp the platform thread row this receipt belongs to. Best-effort and time-boxed by
// design: a receipt is a courtesy on top of a text that has already gone out, and it
// arrives on the live inbound webhook — it must never be able to slow or break a real
// customer message coming the other way.
async function stampThread(providerId, status, at) {
  if (!providerId) return false;
  try {
    const url = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
    const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
    if (!url || !key) return false;
    const patch = { delivery_status: status };
    if (status === 'delivered') patch.delivered_at = at || new Date().toISOString();
    const r = await fetch(
      `${url}/rest/v1/thread_message?provider_id=eq.${encodeURIComponent(providerId)}`,
      {
        method: 'PATCH',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(4000),
      }
    );
    return r.ok;
  } catch (_) { return false; }
}

// Returns { isDlr, failed, status, stamped }. isDlr=true means this was an outbound status
// event and the caller should stop — it is not an inbound message. Never throws.
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
    const providerId = p.id || d.id || '';
    const recips = Array.isArray(p.to) ? p.to : (p.to ? [p.to] : []);

    let failed = null, anyDelivered = false;
    for (const r of recips) {
      const st = String((r && r.status) || '').toLowerCase();
      if (/fail|undeliv|reject|expired|blocked/.test(st)) { failed = { to: (r && (r.phone_number || r)) || '', status: st }; break; }
      if (/delivered/.test(st)) anyDelivered = true;
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

    // Write the outcome back onto the bubble. Only two states are ever claimed — the carrier
    // confirmed the handset had it, or it bounced. An intermediate "sent" is left alone
    // because the row already says that from the moment we handed it over.
    let stamped = false;
    const status = failed ? 'failed' : (anyDelivered ? 'delivered' : '');
    if (status && providerId) {
      stamped = await stampThread(providerId, status, p.completed_at || p.received_at || null);
    }

    return { isDlr: true, failed: !!failed, status: status || 'pending', stamped };
  } catch (_) { return { isDlr: false, failed: false }; }
}

module.exports = { recordIfDeliveryFailure, stampThread };
