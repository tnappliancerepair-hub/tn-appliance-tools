// availability_call_due.js — step 3 (final) of the availability cascade. ~5h
// after the greeting (≈3h after the SMS nudge), if the customer STILL hasn't
// given their availability, Ant places a Vapi call to ask verbally. No-ops if
// availability was captured by then.
//
// The Vapi assistant for this is configured via AVAILABILITY_CALL_ASSISTANT_ID
// (a Vapi assistant that asks "what works / what can't you do" and writes it
// back via the availability tool). Until that's set, it FALLS BACK to texting
// the owner to call — so the data still gets collected today, just by a human,
// and the cascade is complete out of the box.
//
// Signal in:  AVAILABILITY_CALL_DUE { job_id, customer_phone, first_name,
//             appliance_type, service_state, process_after_ms }
import { config } from '../config.js';
import { placeOutboundCall, ASSISTANT_IDS } from '../vapi-out.js';

// Real outbound calls to customers are OFF unless explicitly enabled. Until
// AVAILABILITY_CALL_LIVE=true, the cascade ends by texting the owner to call
// (data still gets collected, just by a human) — so flipping the SMS ask live
// can NEVER accidentally cold-call a customer.
const CALL_LIVE = String(process.env.AVAILABILITY_CALL_LIVE || '') === 'true';

// CT hour (0-23). Used to keep calls inside daytime hours.
function ctHour(d = new Date()) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(d);
  return Number(h) % 24;
}
// Next 9am CT, in unix ms (approx, hour-resolution) — for holding a night call to morning.
function nextMorning9CtMs() {
  const h = ctHour();
  const hoursUntil = h < 9 ? (9 - h) : (24 - h + 9);
  return Date.now() + hoursUntil * 60 * 60 * 1000;
}
const CALL_START_HOUR = 8;   // 8am CT
const CALL_END_HOUR = 19;    // 7pm CT

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const p = signal.payload || {};
  const jobId = Number(p.job_id || 0);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'availability_call_due_handled', { outcome: 'no_job_id' });
    return { success: false, action: 'no_job_id' };
  }

  // Not due yet → sleep again.
  const due = Number(p.process_after_ms || 0);
  if (due && Date.now() < due) {
    await xano.emitSignal({ signal_type: 'AVAILABILITY_CALL_DUE', signal_strength: 45, payload: p });
    await xano.markSignalProcessed(signal.id, 'availability_call_held', { job_id: jobId });
    return { success: true, action: 'held' };
  }

  // Already answered → done.
  const captured = await xano.getEventLogByAction(`availability_captured_${jobId}`).catch(() => null);
  if (captured && captured.exists) {
    const meta = { job_id: jobId, outcome: 'already_captured' };
    await xano.markSignalProcessed(signal.id, 'availability_call_due_handled', meta);
    log('availability_call_due_handled', meta);
    return { success: true, action: 'already_captured' };
  }

  // 2026-06-20 — per-job dedup. This agent was firing the owner-fallback on EVERY
  // re-emit (hold-and-re-emit + duplicate signals) → Teddy got "the same 4 texts
  // 4 times each." A one-time marker per job makes any re-fire a no-op.
  const already = await xano.getEventLogByAction(`availability_chase_done_${jobId}`).catch(() => null);
  if (already && already.exists) {
    const meta = { job_id: jobId, outcome: 'already_chased' };
    await xano.markSignalProcessed(signal.id, 'availability_call_due_handled', meta);
    log('availability_call_due_handled', meta);
    return { success: true, action: 'already_chased' };
  }

  const phone = String(p.customer_phone || '').trim();
  const first = (String(p.first_name || '').trim().split(/\s+/)[0]) || 'there';
  const appliance = String(p.appliance_type || 'appliance').toLowerCase();
  const region = /LA|NOLA|LOUISIANA/i.test(String(p.service_state || '')) ? 'LA' : 'TN';
  const assistantId = String(process.env.AVAILABILITY_CALL_ASSISTANT_ID || ASSISTANT_IDS.availability_collect || '').trim();

  // A real customer call only happens when explicitly enabled, with a phone +
  // assistant, AND inside daytime hours. Outside hours → hold to morning so we
  // never cold-call at night. Not enabled → fall through to the owner-call text.
  const wantLiveCall = CALL_LIVE && phone && assistantId;
  if (wantLiveCall) {
    const hour = ctHour();
    if (hour < CALL_START_HOUR || hour >= CALL_END_HOUR) {
      await xano.emitSignal({
        signal_type: 'AVAILABILITY_CALL_DUE', signal_strength: 45,
        payload: { ...p, process_after_ms: nextMorning9CtMs() },
      });
      await xano.markSignalProcessed(signal.id, 'availability_call_held_quiet_hours', { job_id: jobId, ct_hour: hour });
      log('availability_call_held_quiet_hours', { job_id: jobId, ct_hour: hour });
      return { success: true, action: 'held_quiet_hours', job_id: jobId };
    }
  }

  let outcome = '';
  if (wantLiveCall) {
    const r = await placeOutboundCall({
      assistantId,
      toPhone: phone,
      fromRegion: region,
      variableValues: {
        customer_first_name: first,
        appliance_type: appliance,
        job_id: String(jobId),
      },
      metadata: { source: 'availability_call_due', job_id: jobId },
    }).catch((e) => ({ ok: false, error: String(e.message || e) }));
    outcome = (r && r.ok) ? 'vapi_call_placed' : 'vapi_call_failed';
  } else {
    // Fallback: no assistant configured (or no phone). Per PR #125 owner SMS is
    // CANCELED — save this to the owner portal (event_log 'owner_report') instead
    // of texting Teddy's cell. He sees it on the dashboard; no phone spam.
    if (phone) {
      await xano.recordEventLog('owner_report', {
        source: 'availability_call_owner_fallback',
        body: `Need availability for job #${jobId} — ${first} (${appliance}) hasn't answered the text or portal. ` +
              `Give ${phone} a quick call to get their open days/times so we can schedule.`,
        recipient_role: 'owner',
        job_id: jobId,
        at_ms: Date.now(),
      }).catch(() => {});
      outcome = 'owner_report_saved';
    } else {
      outcome = 'no_phone';
    }
  }

  // One-time per-job marker so any re-emit / duplicate signal no-ops (see dedup above).
  await xano.recordEventLog(`availability_chase_done_${jobId}`, { job_id: jobId, outcome, at_ms: Date.now() }).catch(() => {});

  const meta = { job_id: jobId, outcome, region };
  await xano.markSignalProcessed(signal.id, 'availability_call_due_handled', meta);
  log('availability_call_due_handled', meta);
  return { success: true, action: outcome, job_id: jobId };
}
