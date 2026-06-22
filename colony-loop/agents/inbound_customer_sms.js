// Handles INBOUND_CUSTOMER_SMS signals (emitted by
// api/intake/record_inbound_customer_sms_POST.xs when the Netlify webhook
// proxy gets a Telnyx message.received event from the customer-direction
// number +1 615-588-9500).
//
// Responsibility: classify intent and route to the right sms_response_*
// agent. Today the production catalog has one general-purpose responder:
// sms_response_sms_intent_gap_agent. Until more responders ship, every
// inbound message routes there via SMS_RESPONSE_SMS_INTENT_GAP_AGENT.
//
// Future routes (just add the signal_type — the matching agent will already
// have been built by the architect when it lands):
//   - reschedule keyword → SMS_RESPONSE_RESCHEDULE_REQUEST
//   - cancel keyword     → SMS_RESPONSE_CANCEL_REQUEST
//   - parts question     → SMS_RESPONSE_PARTS_INQUIRY
//   - tech question      → SMS_RESPONSE_TECH_INQUIRY
//   - payment question   → SMS_RESPONSE_PAYMENT_INQUIRY
//   - feedback           → SMS_RESPONSE_POST_JOB_FEEDBACK
//   - complaint          → SMS_RESPONSE_COMPLAINT
//
// Unknown customer (customer_id=0): we still route to the intent-gap
// responder so the caller doesn't go dark. The agent prompt handles
// missing context gracefully.

import { config } from '../config.js';

function digits10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }

// 🛑 Human takeover — has the office (Danielle) texted this customer in the last
// 12h? If so a PERSON is handling the conversation and Ant must NOT auto-reply
// over them (Danielle, 2026-06-22: "having a conversation and the system keeps
// sending the same text"). Checks event_log for an office/manual reply to this
// number. Fails OPEN (auto-reply still works) on any read error.
async function officeHandling(phone) {
  const p10 = digits10(phone);
  if (!p10) return false;
  const since = Date.now() - 12 * 60 * 60 * 1000;
  try {
    const r = await fetch(`${config.xanoIntakeBase}/list_recent_event_log?action=sms_sent&days_back=1&limit=250`);
    const d = await r.json();
    const items = (d && d.items) || [];
    return items.some((it) => {
      if (Number(it.created_at || 0) < since) return false;
      let m = it.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
      const mp = digits10((m && (m.recipient || m.phone || m.to)) || '');
      const tag = String((m && (m.context_tag || m.source || m.tag)) || '').toLowerCase();
      return mp === p10 && /translated_reply|office|manual|danielle|warranty_handler/.test(tag);
    });
  } catch (_) { return false; }
}

const KEYWORD_ROUTES = [
  // Bare M / A / MORNING / AFTERNOON / ANYTIME — reply to the stuck-intake
  // progress nudge. Exact-letter match avoids false positives on
  // conversational messages. Routes to a dedicated handler that updates
  // the customer's open job and advances scheduling_status.
  { type: 'SMS_RESPONSE_TIME_PREFERENCE', re: /^\s*(M|A|MORNING|AFTERNOON|ANYTIME|EITHER|EVENING)\s*[.!]?\s*$/i },
  // Bare RESCHEDULE keyword (as prompted in appointment confirmation +
  // reminder SMS) takes priority — exact-word match avoids false positives
  // on conversational "reschedule" mentions.
  { type: 'SMS_RESPONSE_RESCHEDULE_REQUEST', re: /^\s*RESCHEDULE\s*$/i },
  { type: 'SMS_RESPONSE_RESCHEDULE_REQUEST', re: /\b(reschedule|reschedul|new time|push back|move it|change the time)\b/i },
  { type: 'SMS_RESPONSE_CANCEL_REQUEST',     re: /\b(cancel|cancell|don't need|no longer|nevermind|never mind)\b/i },
  { type: 'SMS_RESPONSE_PARTS_INQUIRY',      re: /\b(part|parts|ordered|shipping|arrival|when will the part)\b/i },
  { type: 'SMS_RESPONSE_PAYMENT_INQUIRY',    re: /\b(invoice|bill|charge|pay|payment|how much|cost|price)\b/i },
  { type: 'SMS_RESPONSE_TECH_INQUIRY',       re: /\b(technician|tech|on the way|eta|arriving|how far)\b/i },
  { type: 'SMS_RESPONSE_COMPLAINT',          re: /\b(unhappy|complain|frustrat|terrible|awful|worst|refund|sue|lawyer)\b/i },
  // "where's my repair / any update / what's the status" → auto-reply with the live
  // status. Checked AFTER the specific intents so they win; this catches the rest.
  { type: 'SMS_RESPONSE_STATUS_INQUIRY',     re: /\b(where(?:'?s| is) my|what(?:'?s| is) (?:the )?status|status of|any update|update on (?:my|the)|what(?:'?s| is) going on|how(?:'?s| is) (?:it|my)|still (?:coming|on)|when (?:are|will) you)\b/i },
];

const FALLBACK_TYPE = 'SMS_RESPONSE_SMS_INTENT_GAP_AGENT';

function classify(body) {
  const text = String(body || '').trim();
  if (!text) return { type: FALLBACK_TYPE, matched: 'empty_body' };
  for (const route of KEYWORD_ROUTES) {
    if (route.re.test(text)) return { type: route.type, matched: route.type };
  }
  return { type: FALLBACK_TYPE, matched: 'no_keyword' };
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const body = String(payload.body || payload.message || '').trim();

  if (!body) {
    const meta = { outcome: 'skipped_empty_body' };
    await xano.markSignalProcessed(signal.id, 'inbound_customer_sms_handled', meta);
    log('inbound_customer_sms_handled', meta);
    return { success: true, action: 'skipped_empty_body' };
  }

  // If the office is already replying to this customer, stay quiet — don't route
  // to ANY auto-responder. A human owns the conversation now.
  const inboundPhone = payload.customer_phone || payload.phone || '';
  if (await officeHandling(inboundPhone)) {
    const meta = { outcome: 'skipped_office_handling', phone: inboundPhone };
    await xano.markSignalProcessed(signal.id, 'inbound_customer_sms_handled', meta);
    log('inbound_customer_sms_handled', meta);
    return { success: true, action: 'skipped_office_handling' };
  }

  let route = classify(body);

  // Availability collection override — if we recently ASKED this customer for
  // their available/unavailable times and they haven't answered yet, treat a
  // GENERIC reply (or a bare time word like "mornings") as that answer.
  // A reply that matched a real intent — parts / payment / tech / complaint /
  // cancel / reschedule — is a genuine question and must NOT be swallowed as
  // availability; let its own handler win.
  const availJobId = Number(payload.job_id || 0);
  const availOverridable = route.type === FALLBACK_TYPE || route.type === 'SMS_RESPONSE_TIME_PREFERENCE';
  if (availJobId && availOverridable) {
    try {
      const asked = await xano.getEventLogByAction(`availability_requested_${availJobId}`).catch(() => null);
      if (asked && asked.exists) {
        const captured = await xano.getEventLogByAction(`availability_captured_${availJobId}`).catch(() => null);
        if (!(captured && captured.exists)) {
          route = { type: 'SMS_RESPONSE_AVAILABILITY', matched: 'pending_availability_request' };
        }
      }
    } catch (_) {}
  }

  // NEW LEAD override — when the inbound SMS comes from a phone that
  // ISN'T on file as an existing customer (customer_id=0/null) AND no
  // specific keyword matched, this is almost certainly a new lead
  // responding to our auto-ack SMS ("text us your appliance type + zip").
  // Route to the dedicated new-lead agent which pushes them to the
  // website chat instead of the generic intent-gap path.
  const customerIdNum = Number(payload.customer_id || 0);
  if ((!customerIdNum || customerIdNum === 0) && route.type === FALLBACK_TYPE) {
    route = { type: 'SMS_RESPONSE_NEW_LEAD', matched: 'no_customer_record' };
  }

  // RESCHEDULE keyword (or intent match) fires an additional owner alert
  // signal in parallel — the existing sms_response_reschedule_request
  // architect agent handles the customer reply; reschedule_request_alert
  // handles the Teddy+Danielle alert.
  if (route.type === 'SMS_RESPONSE_RESCHEDULE_REQUEST') {
    try {
      await xano.emitSignal({
        signal_type: 'RESCHEDULE_REQUEST_ALERT',
        signal_strength: 80,
        payload: {
          job_id: payload.job_id || null,
          customer_id: payload.customer_id || null,
          customer_phone: payload.customer_phone || payload.phone || null,
          first_name: payload.first_name || '',
          appliance_type: payload.appliance_type || '',
          body,
          source: 'inbound_customer_sms',
          source_signal_id: signal.id,
        },
      });
    } catch (err) {
      log('reschedule_alert_emit_failed', { error: String(err.message || err) });
    }
  }

  // Emit the routed responder signal. Downstream agent generates a reply
  // and emits CUSTOMER_SMS_REPLY; customer_sms_reply.js then sends the
  // actual SMS to the customer.
  let routedSignalId = null;
  try {
    const emit = await xano.emitSignal({
      signal_type: route.type,
      signal_strength: 70,
      payload: {
        job_id: payload.job_id || null,
        customer_id: payload.customer_id || null,
        customer_phone: payload.customer_phone || payload.phone || null,
        customer_name: payload.customer_name || payload.first_name || '',
        first_name: payload.first_name || '',
        appliance_type: payload.appliance_type || '',
        scheduling_status: payload.scheduling_status || '',
        body,
        message: body,
        recent_context: payload.recent_context || '',
        provider_sid: payload.provider_sid || '',
        inbound_to: payload.to || '',
        source: 'inbound_customer_sms',
        source_signal_id: signal.id,
      },
    });
    routedSignalId = emit && (emit.signal_id || emit.id);
  } catch (err) {
    log('inbound_customer_sms_route_emit_failed', { error: String(err.message || err), route: route.type });
  }

  const meta = {
    outcome: 'routed',
    matched: route.matched,
    target_signal: route.type,
    routed_signal_id: routedSignalId,
    customer_id: payload.customer_id || 0,
    job_id: payload.job_id || 0,
    body_preview: body.slice(0, 80),
  };
  await xano.markSignalProcessed(signal.id, 'inbound_customer_sms_handled', meta);
  log('inbound_customer_sms_handled', meta);

  return { success: true, action: 'routed', target: route.type };
}
