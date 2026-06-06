// Handles REACTIVATION_CAMPAIGN signals (emitted weekly Mon 11am CT by
// tick.js). For up to N dormant-customer candidates this week, sends:
//   'Hi {first}! It's been a while - TN Appliance is still here. Need
//    anything fixed? Reply YES and we'll get you on the calendar.'
//
// Per-customer-yearly dedup to avoid annoying churned customers.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

const WEEKLY_CAP = 10;

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let candidates = [];
  try {
    const res = await fetch(`${config.xanoIntakeBase}/list_reactivation_candidates?limit=50`);
    const data = await res.json();
    candidates = (data && data.candidates) || [];
  } catch (err) {
    log('reactivation_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'reactivation_campaign_handled', {
      outcome: 'load_failed',
    });
    return { success: false, action: 'load_failed' };
  }

  if (candidates.length === 0) {
    await xano.markSignalProcessed(signal.id, 'reactivation_campaign_handled', {
      outcome: 'no_candidates',
    });
    return { success: true, action: 'no_candidates' };
  }

  const results = { sent: 0, skipped_dedup: 0, skipped_no_phone: 0, errors: 0 };

  for (const c of candidates) {
    if (results.sent >= WEEKLY_CAP) break;

    const dedupAction = `reactivation_sent_customer_${c.customer_id}_${new Date().getFullYear()}`;
    let prior = null;
    try { prior = await xano.getEventLogByAction(dedupAction); } catch (e) { /* */ }
    if (prior && prior.exists) {
      results.skipped_dedup += 1;
      continue;
    }

    const phone = normalizeE164(c.phone);
    if (!phone) {
      results.skipped_no_phone += 1;
      continue;
    }

    const first = String(c.first_name || '').trim() || 'there';
    const body =
      `Hi ${first}! It's been a while - TN Appliance is still here in Middle TN + Southeast LA. ` +
      `Anything need fixing? Reply YES and we'll get you on the calendar. Or call 866-268-0111. -TN Appliance`;

    let smsRes = null;
    try {
      smsRes = await toCustomer(phone, body, {
        action: 'reactivation_sent',
        customer_id: c.customer_id,
        source_signal_id: signal.id,
      });
      results.sent += 1;
    } catch (err) {
      results.errors += 1;
      log('reactivation_sms_failed', { customer_id: c.customer_id, error: String(err.message || err) });
    }

    try {
      await xano.recordEventLog(dedupAction, {
        customer_id: c.customer_id,
        sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
      });
    } catch (e) { /* */ }
  }

  await xano.markSignalProcessed(signal.id, 'reactivation_campaign_handled', {
    outcome: 'swept',
    candidate_count: candidates.length,
    ...results,
  });
  log('reactivation_campaign_handled', { outcome: 'swept', ...results });
  return { success: true, action: 'swept', ...results };
}
