// PARTS ARRIVED → CUSTOMER NOTIFY
//
// Fires on PARTS_ARRIVED signal — the second consumer alongside
// parts_arrived_quick_schedule.js. While that one SMSes the tech +
// Teddy with a scheduler proposal, THIS one SMSes the CUSTOMER:
//
//   "[TN Appliance] Great news — your parts are here! Tap to pick a
//    return-visit time: tnapplianceexchange.net/customer-portal.html
//    ?job_id=18020"
//
// The customer's portal already renders a celebration state when
// job.parts_status === 'arrived' (see customer-portal.html). They tap
// the link → portal shows "🎉 Your parts arrived! Pick a return time"
// → existing portal scheduling action proposes a window.
//
// This is the missing rail Teddy flagged: "Are we wiring it to the
// customer portal? If so this is brilliant." Yes — and now it's live.
//
// Gates:
//   - send_sms gating layer enforces CUSTOMER_FACING_ENABLED. While
//     that flag is false (Phase 1 hard rule), the SMS is dropped at
//     the send_sms endpoint and Teddy is notified instead. So no
//     customer SMS escape during shadow-launch period.
//   - 24h per-job dedup so a re-fire of PARTS_ARRIVED doesn't
//     duplicate.
//   - Skip if no customer phone on file.
//   - Skip after 8pm / before 8am CT — no after-hours pings.

import { composeForChannel } from '../channel.js';

const CT_TZ = 'America/Chicago';
const BASE_URL = 'https://tnapplianceexchange.net';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'parts_arrived_customer_notify_skipped', { reason: 'no_job_id' });
    return { success: true, action: 'skipped_no_job' };
  }

  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: CT_TZ, hour: 'numeric', hour12: false }), 10);
  if (hour < 8 || hour >= 20) {
    await xano.markSignalProcessed(signal.id, 'parts_arrived_customer_notify_skipped', { reason: 'after_hours', hour });
    return { success: true, action: 'skipped_after_hours' };
  }

  // 24h per-job dedup
  const dedupAction = `parts_customer_notify_${jobId}`;
  try {
    const recent = await xano.listRecentEventLog({ action: dedupAction, days_back: 1, limit: 1 });
    if (recent && recent.length > 0) {
      await xano.markSignalProcessed(signal.id, 'parts_arrived_customer_notify_skipped', { reason: 'already_notified' });
      return { success: true, action: 'skipped_already_notified' };
    }
  } catch (_) {}

  // Pull job + customer
  let job = null;
  let customer = null;
  try {
    const r = await xano.getJobForDashboard(jobId).catch(() => null);
    if (r) { job = r.job || null; customer = r.customer || null; }
  } catch (_) {}

  if (!job || !customer || !customer.phone) {
    await xano.markSignalProcessed(signal.id, 'parts_arrived_customer_notify_skipped', { reason: 'no_customer_phone' });
    return { success: true, action: 'skipped_no_phone' };
  }

  const phoneLast4 = String(customer.phone || '').replace(/\D/g, '').slice(-4);
  const firstName = (customer.first_name || 'there').trim();
  const appl = (job.appliance_type || 'appliance').toLowerCase();
  const portalUrl = `${BASE_URL}/customer-portal.html?job_id=${jobId}&last4=${phoneLast4}`;

  // Channel-aware composition: portal-prefering customers get a short
  // push to the portal; SMS-prefering customers get the full info
  // inline + a reply prompt instead of a portal link.
  const composed = await composeForChannel({
    customerId: customer.id,
    intro: `great news ${firstName} — your parts for the ${appl} repair are here`,
    inlineDetail: `Reply with a day + time window that works (e.g. "Thursday afternoon") and we'll get you back on the schedule.`,
    portalUrl,
    portalActionLabel: 'pick a return-visit time',
  });
  const body = composed.body;

  // sms.toCustomer enforces the CUSTOMER_FACING_ENABLED gate at the
  // send_sms endpoint. If gated, the message is dropped + Teddy is
  // notified. Once Teddy flips CUSTOMER_FACING_ENABLED=true, this
  // path goes live for real customers.
  let smsResult;
  try {
    smsResult = await sms.toCustomer({
      phone: customer.phone,
      body,
      job_id: jobId,
      customer_id: customer.id,
      call_site: 'parts_arrived_customer_notify',
    });
  } catch (e) {
    smsResult = { ok: false, error: String(e) };
  }

  try {
    await xano.recordEvent(dedupAction, {
      job_id: jobId,
      customer_id: customer.id,
      sms_ok: !!(smsResult && smsResult.ok),
      gated: !!(smsResult && smsResult.gated),
      channel_pref: composed.prefers,
    });
  } catch (_) {}

  await xano.markSignalProcessed(signal.id, 'parts_arrived_customer_notify_handled', {
    job_id: jobId,
    sms_ok: !!(smsResult && smsResult.ok),
    gated: !!(smsResult && smsResult.gated),
    channel_pref: composed.prefers,
  });

  log('parts_arrived_customer_notify_sent', { job_id: jobId, gated: !!(smsResult && smsResult.gated), channel: composed.prefers });
  return { success: true, action: 'sent' };
}
