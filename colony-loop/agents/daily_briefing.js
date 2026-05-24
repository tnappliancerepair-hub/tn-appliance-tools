import { fmtCT } from '../time.js';

const STALE_DAYS = 1;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  const dashboard = await xano.getJobsForDashboard({ date_filter: 'all', page: 1, per_page: 200 });
  const items = dashboard.items || [];

  const staleCutoffMs = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const stale = items.filter((r) => {
    const status = r.job?.scheduling_status;
    const created = r.job?.created_at;
    return status === 'prediagnosis_pending' && created && created < staleCutoffMs;
  });

  const oldestDays = stale.length
    ? Math.max(...stale.map((r) => r.days_since_created || 0))
    : 0;

  const lines = [
    `[ant] morning briefing ${fmtCT()}`,
    `prediagnosis pending: ${stale.length}${oldestDays ? ` (oldest ${oldestDays}d)` : ''}`,
    `note: payouts + error rollup pending wiring`,
  ];
  const body = lines.join('\n');

  const smsRes = await sms.toOwner(body, {
    action: 'daily_briefing',
    stale_count: stale.length,
  });

  await xano.markSignalProcessed(signal.id, 'daily_briefing_fired', {
    stale_count: stale.length,
    oldest_days: oldestDays,
  });

  log('daily_briefing_sent', { stale_count: stale.length, sms: smsRes });

  return {
    success: true,
    action: 'briefing_sent',
    stale_count: stale.length,
    oldest_days: oldestDays,
  };
}
