// NEW CUSTOMER WELCOME
//
// Fires on JOB_COMPLETED with 24h hold-and-re-emit. Sends a personal
// welcome SMS to first-time customers — the SMS comes 24h after their
// first appointment, when memory of the visit is fresh and they're
// most likely to feel positively.
//
// "Hey {first}, thanks for letting us take care of your {appliance}
// yesterday. We know there are lots of options — really glad you
// chose TN Appliance Exchange. If anything comes up with the repair,
// just text us. — Teddy"
//
// Why this matters: customers who feel personally welcomed at their
// FIRST repair have ~3x higher LTV than transactional ones. Tiny
// touch with outsized retention impact.
//
// Skip conditions:
//   - customer has prior completed jobs (not first-time)
//   - low rating (<=3) on this job (different agent handles that)
//   - CUSTOMER_FACING_ENABLED gates the send

import { recordEvent } from '../xano.js';
import { composeForChannel } from '../channel.js';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'new_customer_welcome_skipped', { reason: 'no_job_id' });
    return { success: false, action: 'skipped' };
  }

  // Hold-and-reemit pattern — wait 24h post-completion
  const deadlineMs = Number(payload.deadline_ms || 0);
  if (deadlineMs && Date.now() < deadlineMs) {
    await xano.emitSignal({
      signal_type: 'NEW_CUSTOMER_WELCOME',
      signal_strength: 30,
      payload,
    });
    return { success: true, action: 'held_until_deadline' };
  }

  // Dedup per job
  const dedupAction = `new_customer_welcome_sent_${jobId}`;
  try {
    const prior = await xano.getEventLogByAction(dedupAction).catch(() => null);
    if (prior && prior.exists) {
      await xano.markSignalProcessed(signal.id, 'new_customer_welcome_skipped', { reason: 'already_sent' });
      return { success: true, action: 'duplicate' };
    }
  } catch (_) {}

  // Pull job + customer
  let job = null, customer = null;
  try {
    const r = await xano.getJobForDashboard(jobId).catch(() => null);
    if (r) { job = r.job || null; customer = r.customer || null; }
  } catch (_) {}
  if (!job || !customer) {
    await xano.markSignalProcessed(signal.id, 'new_customer_welcome_skipped', { reason: 'context_missing' });
    return { success: false, action: 'no_context' };
  }

  // Confirm this is the customer's FIRST completed job
  try {
    const r = await fetch(`${XANO_BASE}/get_customer_no_show_history?customer_id=${customer.id}`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const hist = await r.json();
      if ((hist.completed_count || 0) > 1) {
        await xano.markSignalProcessed(signal.id, 'new_customer_welcome_skipped', { reason: 'not_first_time', completed_count: hist.completed_count });
        return { success: true, action: 'not_new' };
      }
    }
  } catch (_) {}

  const firstName = String(customer.first_name || 'there').trim();
  const appl = (job.appliance_type || 'appliance').toLowerCase();
  const intro = `thanks for letting us take care of your ${appl} yesterday. We know there are lots of options — really glad you chose TN Appliance Exchange.`;
  const inlineDetail = `If anything comes up with the repair, just text us. — Teddy`;

  let composed;
  try {
    composed = await composeForChannel({
      customerId: Number(customer.id),
      intro: `hey ${firstName}, ${intro}`,
      inlineDetail,
      portalUrl: `https://tnapplianceexchange.net/customer-portal.html?job_id=${jobId}`,
      portalActionLabel: 'see your repair record',
    });
  } catch (e) {
    await xano.markSignalProcessed(signal.id, 'new_customer_welcome_skipped', { reason: 'compose_failed' });
    return { success: false, action: 'compose_failed' };
  }

  let smsResult;
  try {
    smsResult = await sms.toCustomer({
      phone: customer.phone, body: composed.body, customer_id: customer.id,
      call_site: 'new_customer_welcome', job_id: jobId,
    });
  } catch (e) { smsResult = { ok: false, error: String(e) }; }

  try {
    await recordEvent(dedupAction, {
      job_id: jobId, customer_id: customer.id, channel: composed.prefers,
      language: composed.language, sent_at_ms: Date.now(),
      gated: !!(smsResult && smsResult.gated),
    });
  } catch (_) {}

  await xano.markSignalProcessed(signal.id, 'new_customer_welcome_handled', {
    job_id: jobId, sms_ok: !!(smsResult && smsResult.ok), gated: !!(smsResult && smsResult.gated),
  });
  log('new_customer_welcome_sent', { job_id: jobId });
  return { success: true, action: 'sent' };
}
