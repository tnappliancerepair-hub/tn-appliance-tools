// WEEKLY DANIELLE RECEIPT
//
// Fires Friday 5pm CT. Aggregates the past 7 days of automation outputs
// + estimates time saved using conservative per-task multipliers. SMSes
// Teddy ONE forwardable text. He chooses when/whether to forward it.
//
// The "parallel-run pattern" — Danielle keeps doing things her way; the
// system runs alongside her; she sees the receipt pile up without being
// asked to USE anything new. After 4-8 weeks of receipts, she trusts
// what's happening and starts asking for more automation, not less.
//
// Per-task time-saved multipliers are conservative on purpose. We'd
// rather understate and let her be pleasantly surprised than overstate
// and lose credibility on the first text.
//
// MULTIPLIERS (minutes per task — what she'd spend doing it manually):
//   warranty_draft        =  8 min
//   customer_confirmation =  2 min
//   inbound_sms_reply     =  3 min
//   job_auto_scheduled    = 10 min
//   reschedule_offer      =  6 min
//   parts_arrival_routed  =  4 min
//   stuck_job_surfaced    =  5 min
//   re_engagement_sent    =  3 min
//   pre_job_intel_staged  =  4 min
//
// Total minutes / 60 = hours saved this week. Rounded down.

import { listRecentEventLog } from '../xano.js';

const ESTIMATES_MIN = {
  warranty_claim_action_persisted: 8,
  appointment_scheduled_signal_emitted: 2,
  inbound_customer_sms_received: 3,
  scheduling_queue_propose_enqueued: 10,
  pending_reschedule_offer: 6,
  parts_marked_arrived: 4,
  stuck_job_detector_handled: 5,    // single digest, not per-job — but still saves her hunting time
  customer_re_engaged: 3,
  pre_job_intelligence_prestager_handled: 4,
};

const LABELS = {
  warranty_claim_action_persisted: 'warranty drafts prepared',
  appointment_scheduled_signal_emitted: 'appointment confirmations sent',
  inbound_customer_sms_received: 'inbound customer texts handled',
  scheduling_queue_propose_enqueued: 'scheduling proposals auto-queued',
  pending_reschedule_offer: 'reschedule offers sent to customers',
  parts_marked_arrived: 'parts arrivals routed to tech + customer',
  customer_re_engaged: 'old-customer maintenance check-ins',
  pre_job_intelligence_prestager_handled: 'pre-job intelligence runs',
};

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  const counts = {};
  let totalMin = 0;

  for (const action of Object.keys(ESTIMATES_MIN)) {
    let rows = [];
    try {
      rows = await listRecentEventLog({ action, days_back: 7, limit: 2000 });
    } catch (_) {}
    let n = 0;
    if (action === 'pre_job_intelligence_prestager_handled' || action === 'stuck_job_detector_handled') {
      // These are per-run aggregates — multiplier reflects work per RUN,
      // not per job within. Cap at 1/day.
      n = Math.min((rows || []).length, 7);
    } else {
      n = (rows || []).length;
    }
    counts[action] = n;
    totalMin += n * ESTIMATES_MIN[action];
  }

  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  const totalLabel = hours > 0 ? `${hours}h ${remMin}m` : `${remMin}m`;

  // Compose forwardable text — short, specific, no fluff.
  const lines = ['[ant] Friday receipt — what the system did this week:'];
  let anyWork = false;
  for (const [action, n] of Object.entries(counts)) {
    if (n <= 0) continue;
    const lbl = LABELS[action] || action;
    lines.push(`  • ${n} ${lbl}`);
    anyWork = true;
  }
  if (!anyWork) {
    lines.push('  (no automation activity this week)');
  }
  lines.push('');
  lines.push(`Estimated ~${totalLabel} of work handled automatically.`);
  lines.push('');
  lines.push('Forward to Danielle when ready.');

  const body = lines.join('\n');

  let smsResult;
  try { smsResult = await sms.toOwner(body, { call_site: 'weekly_danielle_receipt' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  await xano.markSignalProcessed(signal.id, 'weekly_danielle_receipt_handled', {
    total_min_saved: totalMin,
    counts,
    sms_ok: !!(smsResult && smsResult.ok),
  });
  log('weekly_danielle_receipt_sent', { total_min: totalMin, categories_with_work: Object.values(counts).filter(n => n > 0).length });
  return { success: true, action: 'sent', total_min: totalMin };
}
