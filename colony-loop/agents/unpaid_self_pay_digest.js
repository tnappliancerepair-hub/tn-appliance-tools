// Handles UNPAID_SELF_PAY_DIGEST signals (emitted daily 10:30am CT by
// tick.js). Pulls all self-pay jobs completed in the last 14 days where
// payment_collected is false, sends Teddy a digest:
//
//   [ant] 💰 unpaid self-pay (N jobs):
//   • Sarah · refrigerator · job #18095 · 3d ago
//   • Bob · dryer · job #18099 · 5d ago
//   • Carol · dishwasher · job #18102 · 8d ago
//   ...
//   Open office-pulse: …
//
// Skip if zero unpaid — silent (no need to nag with "all paid").
import { config } from '../config.js';
import { toOwner } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let payload;
  try {
    payload = await xano.getUnpaidSelfPayJobs();
  } catch (err) {
    log('unpaid_self_pay_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'unpaid_self_pay_digest_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed' };
  }

  const jobs = (payload && payload.jobs) || [];
  if (jobs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'unpaid_self_pay_digest_handled', {
      outcome: 'all_paid',
    });
    log('unpaid_self_pay_digest_handled', { outcome: 'all_paid' });
    return { success: true, action: 'all_paid', job_count: 0 };
  }

  // Compose digest (cap to top 10 by oldest)
  const sorted = jobs.slice().sort((a, b) => Number(b.days_since || 0) - Number(a.days_since || 0));
  const show = sorted.slice(0, 10);
  const more = sorted.length > 10 ? `\n+ ${sorted.length - 10} more` : '';

  const lines = show.map((j) => {
    const name = String(j.customer_first || 'customer');
    const appl = String(j.appliance_type || 'job');
    const d = j.days_since || 0;
    return `• ${name} · ${appl} · job #${j.job_id} · ${d}d ago`;
  });

  const body =
    `[ant] 💰 unpaid self-pay (${jobs.length} job${jobs.length === 1 ? '' : 's'}):\n` +
    lines.join('\n') +
    more +
    `\nReview: ${bareDomain()}/office-pulse.html`;

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'unpaid_self_pay_digest_sent',
      job_count: jobs.length,
      oldest_days: sorted[0] ? sorted[0].days_since : 0,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    outcome: smsRes && smsRes.success ? 'digest_sent' : 'send_failed',
    job_count: jobs.length,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'unpaid_self_pay_digest_handled', meta);
  log('unpaid_self_pay_digest_handled', meta);

  return { success: true, action: meta.outcome, job_count: jobs.length };
}
