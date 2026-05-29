// CUSTOMER RESCHEDULE OFFER
//
// Fires on CUSTOMER_RESCHEDULE_OFFER signal (emitted by
// inbound_customer_sms.js when reschedule/cancel intent detected AND
// the customer has an active scheduled job).
//
// Flow:
//   1. Load the customer's active job + tech
//   2. Call get_tech_slots_for_zip → returns up to 5 next available
//      windows for that tech (3 hour windows, weekday only, capacity
//      checked)
//   3. Compose a customer-friendly SMS offering top 3 with reply
//      instructions: "Reply 1, 2, or 3. Or 'cancel' if you'd rather
//      just cancel."
//   4. Persist a pending_reschedule_offer event_log row so the
//      pickup handler knows which slots map to 1/2/3
//   5. Send SMS via composeForChannel (tone + language aware)
//
// When customer replies, inbound_customer_sms.js detects the pickup
// pattern and fires CUSTOMER_RESCHEDULE_PICKUP → handled by
// customer_reschedule_pickup.js which calls reschedule_job_POST.

import { recordEvent, listRecentEventLog } from '../xano.js';
import { composeForChannel } from '../channel.js';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const MAX_OFFER_AGE_MIN = 90; // pending offer expires after 90 min

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const customerId = Number(payload.customer_id);
  const jobId = Number(payload.job_id);

  if (!customerId || !jobId) {
    await xano.markSignalProcessed(signal.id, 'customer_reschedule_offer_skipped', { reason: 'missing_ids' });
    return { success: false, action: 'no_ids' };
  }

  // Dedup — don't fire repeatedly for the same job in a short window
  try {
    const recent = await listRecentEventLog({ action: 'pending_reschedule_offer', days_back: 1, limit: 5 });
    const needle = `"job_id":${jobId}`;
    const fresh = (recent || []).find((r) => {
      try {
        const m = typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata || {});
        return m.includes(needle);
      } catch (_) { return false; }
    });
    if (fresh) {
      const freshAgeMin = (Date.now() - Number(fresh.created_at || 0)) / 60_000;
      if (freshAgeMin < MAX_OFFER_AGE_MIN) {
        await xano.markSignalProcessed(signal.id, 'customer_reschedule_offer_skipped', { reason: 'offer_pending', age_min: Math.round(freshAgeMin) });
        return { success: true, action: 'already_pending' };
      }
    }
  } catch (_) {}

  // Pull job + customer + tech context
  let job, customer;
  try {
    const r = await xano.getJobForDashboard(jobId).catch(() => null);
    if (r) { job = r.job || null; customer = r.customer || null; }
  } catch (_) {}
  if (!job || !customer) {
    await xano.markSignalProcessed(signal.id, 'customer_reschedule_offer_skipped', { reason: 'context_missing', job_id: jobId });
    return { success: false, action: 'no_context' };
  }
  const techId = Number(job.technician_id || 0);
  if (!techId) {
    await xano.markSignalProcessed(signal.id, 'customer_reschedule_offer_skipped', { reason: 'no_tech_assigned' });
    return { success: false, action: 'no_tech' };
  }

  // Pull slots for tech
  let slots = [];
  try {
    const r = await fetch(`${XANO_BASE}/get_tech_slots_for_zip?technician_id=${techId}&days_ahead=7&max_slots=5`, {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const data = await r.json();
      slots = (data && data.slots) || [];
    }
  } catch (e) { log('reschedule_offer_slots_query_failed', { error: String(e) }); }

  if (slots.length === 0) {
    // Tech has no availability — escalate to owner instead
    try {
      await sms.toOwner(`[ant] customer reschedule request — job #${jobId} (${customer.first_name} ${customer.last_name}, tech ${techId}) but NO open slots in next 7d. Manual follow-up needed.`, { call_site: 'customer_reschedule_offer' });
    } catch (_) {}
    await xano.markSignalProcessed(signal.id, 'customer_reschedule_offer_handled', { outcome: 'no_slots_escalated', job_id: jobId });
    return { success: true, action: 'no_slots_escalated' };
  }

  // Take top 3 — easier on customer
  const offered = slots.slice(0, 3);

  // Persist the pending offer
  let offerLogId = 0;
  try {
    const r = await recordEvent('pending_reschedule_offer', {
      customer_id: customerId,
      job_id: jobId,
      tech_id: techId,
      slots: offered,
      offered_at_ms: Date.now(),
      expires_at_ms: Date.now() + MAX_OFFER_AGE_MIN * 60_000,
    });
    if (r && r.event_log_id) offerLogId = r.event_log_id;
  } catch (_) {}

  // Compose the SMS through composeForChannel (style + language aware)
  const firstName = String(customer.first_name || 'there').trim();
  const optionLines = offered.map((s, i) => `${i + 1}) ${s.label}`).join('\n');
  const intro = `no problem ${firstName} — here are some other times your tech can come back`;
  const inlineDetail = `${optionLines}\n\nReply 1, 2, or 3 to pick one. Or reply CANCEL if you'd rather not reschedule.`;

  let composed;
  try {
    composed = await composeForChannel({
      customerId,
      intro,
      inlineDetail,
    });
  } catch (_) {
    composed = { body: `[TN Appliance] ${intro}.\n\n${inlineDetail}`, prefers: 'unknown' };
  }

  let smsResult;
  try {
    smsResult = await sms.toCustomer({
      phone: customer.phone, body: composed.body, customer_id: customerId,
      call_site: 'customer_reschedule_offer', job_id: jobId,
    });
  } catch (e) { smsResult = { ok: false, error: String(e) }; }

  await xano.markSignalProcessed(signal.id, 'customer_reschedule_offer_handled', {
    job_id: jobId, tech_id: techId, slots_offered: offered.length,
    sms_ok: !!(smsResult && smsResult.ok), gated: !!(smsResult && smsResult.gated),
    offer_log_id: offerLogId,
  });
  log('customer_reschedule_offer_sent', { job_id: jobId, slots: offered.length });
  return { success: true, action: 'offered', slot_count: offered.length };
}
