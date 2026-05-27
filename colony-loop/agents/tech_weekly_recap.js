// Phase 2c — Sunday-evening proactive recap to each active tech.
//
// Fires from TECH_WEEKLY_RECAP signal (emitted by tick.js Sunday 6-8pm CT).
// For each active tech (excluding orphan id=8, including Teddy id=1
// since he's also a working tech), pulls their week stats and texts:
//   - count of jobs completed
//   - total earnings (if available)
//   - a friendly close + invitation to text any preference change
//
// Dedup via event_log action="tech_weekly_recap_sent" on (tech_id, week_start).
// Skips silent if the tech had zero activity (no jobs, no logins) — no
// point pinging someone who didn't work this week.
import { toTech } from '../sms.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const weekStartMs = Number(payload.since_ts_ms) || 0;

  let techs;
  try {
    techs = await xano.getTechnicians();
  } catch (err) {
    const meta = { outcome: 'tech_list_load_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'tech_weekly_recap_handled', meta);
    log('tech_weekly_recap_handled', meta);
    return { success: false, action: 'tech_list_load_failed' };
  }

  const eligible = (Array.isArray(techs) ? techs : (techs?.items || []))
    .filter(t => t && t.active === true && t.id !== 8); // skip orphan

  let sent = 0;
  let skipped = 0;

  for (const tech of eligible) {
    // Dedup — has the recap already gone out for this week?
    let alreadySent = false;
    try {
      const dedup = await xano.getTechWeeklyRecapSent({ tech_id: tech.id, week_start_ms: weekStartMs });
      alreadySent = dedup && dedup.sent === true;
    } catch (err) {
      log('tech_weekly_recap_dedup_failed', { tech_id: tech.id, error: String(err.message || err) });
    }

    if (alreadySent) {
      skipped++;
      continue;
    }

    // Pull the week's performance
    let perf;
    try {
      perf = await xano.getTechPerformance({ tech_id: tech.id, period: 'week' });
    } catch (err) {
      log('tech_weekly_recap_perf_failed', { tech_id: tech.id, error: String(err.message || err) });
      skipped++;
      continue;
    }

    const completed = perf?.completed_count || 0;
    const earnings = perf?.earnings_total || 0;
    const firstName = (tech.first_name || '').trim() || 'there';

    // Skip if zero activity — nothing to recap, no point pinging
    if (completed === 0) {
      log('tech_weekly_recap_zero_activity', { tech_id: tech.id });
      skipped++;
      continue;
    }

    const earningsLine = earnings > 0
      ? `\nEarnings: $${earnings.toFixed(2)}`
      : '';

    const body =
      `[ant] hey ${firstName} — week wrap: ${completed} job${completed === 1 ? '' : 's'} done.${earningsLine}\n\n` +
      `anything to change for next week? text me:\n` +
      `  HOURS 9-6 (working window)\n` +
      `  OFF SAT (day off)\n` +
      `  MAX 5 (cap jobs/day)\n` +
      `  NO MICROWAVE (skip type)\n` +
      `  SKIP HAMMOND (skip area)\n` +
      `or text STATUS to see your settings.`;

    let smsRes;
    try {
      smsRes = await toTech(tech.phone, body, {
        action: 'tech_weekly_recap_sent',
        tech_id: tech.id,
        week_start_ms: weekStartMs,
        completed_count: completed,
        earnings_total: earnings,
      });
    } catch (err) {
      log('tech_weekly_recap_sms_failed', { tech_id: tech.id, error: String(err.message || err) });
      skipped++;
      continue;
    }

    // Persist dedup row
    try {
      await xano.recordEventLog('tech_weekly_recap_sent', {
        tech_id: tech.id,
        week_start_ms: weekStartMs,
        completed_count: completed,
        earnings_total: earnings,
        sms_ok: smsRes && smsRes.success,
      });
    } catch (err) {
      log('tech_weekly_recap_event_log_failed', { tech_id: tech.id, error: String(err.message || err) });
    }

    sent++;
  }

  const meta = {
    outcome: 'recap_sent',
    sent,
    skipped,
    eligible_count: eligible.length,
    week_start_ms: weekStartMs,
  };
  await xano.markSignalProcessed(signal.id, 'tech_weekly_recap_handled', meta);
  log('tech_weekly_recap_handled', meta);

  return { success: true, action: meta.outcome, sent, skipped };
}
