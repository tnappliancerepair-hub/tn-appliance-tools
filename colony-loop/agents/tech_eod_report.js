// Daily 6pm CT — SMSes each active tech an end-of-day wrap-up.
// One of three approved tech-SMS channels per Teddy's 2026-06-04
// hardline policy.
//
// Content: count of jobs completed, count still open, parts ordered,
// gentle nudge if TDRs are still missing.
//
// Signal in: TECH_EOD_REPORT (cron from tick.js 6-9pm CT grace window)

import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  const techsRes = await xano.getTechnicians();
  const techs = (techsRes && techsRes.technicians) ? techsRes.technicians : (Array.isArray(techsRes) ? techsRes : []);
  const active = techs.filter((t) => t && t.active && t.id && t.phone && Number(t.id) !== 8);

  let sent = 0;
  let skipped = 0;
  for (const t of active) {
    try {
      const data = await xano.getTechDailyDashboard(t.id);
      const jobs = (data && data.jobs) || [];
      const completed = jobs.filter((j) => {
        const s = String(((j.job || {}).scheduling_status || (j.job || {}).current_status || '')).toLowerCase();
        return s === 'completed' || s === 'complete';
      }).length;
      const open = jobs.length - completed;
      const firstName = (t.first_name || 'brother');

      let body;
      if (jobs.length === 0) {
        body = `[ant] EOD ${firstName} — quiet day. See you tomorrow.`;
        skipped++;
        continue;
      } else if (completed === jobs.length) {
        body = `[ant] EOD ${firstName} — full sweep: ${completed} of ${jobs.length} closed out. Hell yeah. Drive safe.`;
      } else if (completed === 0) {
        body = `[ant] EOD ${firstName} — ${open} open today. Whatever didn't close, tap Mark Complete on tech-simple and Brooke'll walk the wrap-up. Drive safe.`;
      } else {
        body = `[ant] EOD ${firstName} — ${completed} done, ${open} open. Wrap the open ones via Talk to Ant when you get a chance. Drive safe.`;
      }

      await xano.sendSms(t.phone, body, {
        recipient_role: 'tech', source: 'tech_eod_report', action: 'tech_eod_report',
        tech_id: t.id, completed, open,
      });
      sent++;
    } catch (e) {
      log('tech_eod_report_tech_error', { tech_id: t.id, error: e.message });
    }
  }

  const meta = { sent, skipped, total_active: active.length, outcome: 'tech_eod_report_sent' };
  await xano.markSignalProcessed(signal.id, 'tech_eod_report_sent', meta);
  log('tech_eod_report_sent', meta);
  return { success: true, action: 'tech_eod_report_sent', sent };
}
