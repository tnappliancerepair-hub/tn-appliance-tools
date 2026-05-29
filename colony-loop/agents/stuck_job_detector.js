// STUCK JOB DETECTOR
//
// Daily 8:15am CT (8-10 grace) — finds jobs that have been sitting in
// any non-terminal status > N days and SMSes Teddy + Danielle a
// digest. Closes the "I forgot about that one" operational gap.
//
// Thresholds (per stage):
//   not_ready          → stuck >  5 days  (didn't get scheduled)
//   prediagnosis_pending → stuck > 7 days
//   intake_complete    → stuck >  5 days
//   scheduled          → stuck > 14 days  (way past scheduled_start)
//   awaiting_parts     → stuck > 14 days  (parts ETA blown)
//   held / on_hold     → stuck >  7 days
//   in_progress        → stuck >  2 days  (rare — usually wrapping same day)
//
// Per-status thresholds because "stuck" means different things in
// each stage. Emergency stuck (in_progress > 2d) is louder.

import { listRecentEventLog, recordEvent } from '../xano.js';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const STUCK_THRESHOLDS_DAYS = {
  not_ready: 5,
  prediagnosis_pending: 7,
  intake_complete: 5,
  scheduled: 14,
  awaiting_parts: 14,
  held: 7,
  on_hold: 7,
  in_progress: 2,
};

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  // Pull all non-terminal jobs in one batch
  let stuckJobs = [];
  for (const [status, thresholdDays] of Object.entries(STUCK_THRESHOLDS_DAYS)) {
    try {
      const r = await fetch(`${XANO_BASE}/list_jobs_by_status?status=${encodeURIComponent(status)}&limit=200`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const items = (data && data.items) || [];
      const cutoffMs = Date.now() - thresholdDays * 86400000;
      for (const j of items) {
        const lastUpdatedMs = Number(j.updated_at || j.created_at || 0);
        if (lastUpdatedMs > 0 && lastUpdatedMs < cutoffMs) {
          const daysStuck = Math.round((Date.now() - lastUpdatedMs) / 86400000);
          stuckJobs.push({
            id: j.id,
            customer_name: j.customer_name || '',
            appliance: j.appliance_type || '',
            status,
            tech_first_name: j.tech_first_name || '',
            days_stuck: daysStuck,
            warranty_company: j.warranty_company || '',
          });
        }
      }
    } catch (_) {}
  }

  if (stuckJobs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'stuck_job_detector_handled', { stuck_count: 0 });
    log('stuck_job_detector_clean', {});
    return { success: true, action: 'no_stuck_jobs' };
  }

  // Sort by days_stuck DESC + cap to 15 worst
  stuckJobs.sort((a, b) => b.days_stuck - a.days_stuck);
  const top = stuckJobs.slice(0, 15);

  const lines = [`[ant] ${stuckJobs.length} stuck jobs (top ${top.length}):`];
  for (const j of top) {
    const warranty = j.warranty_company ? ` (${j.warranty_company})` : '';
    lines.push(`  #${j.id} ${j.customer_name} · ${j.appliance} · ${j.status} · ${j.days_stuck}d${warranty}`);
  }
  lines.push('');
  lines.push('Office todo: tnapplianceexchange.net/office-todo.html');

  let smsResult;
  try { smsResult = await sms.toOwner(lines.join('\n'), { call_site: 'stuck_job_detector' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  await xano.markSignalProcessed(signal.id, 'stuck_job_detector_handled', {
    stuck_count: stuckJobs.length,
    top_count: top.length,
    sms_ok: !!(smsResult && smsResult.ok),
  });
  log('stuck_job_detector_sent', { count: stuckJobs.length });
  return { success: true, action: 'sent', count: stuckJobs.length };
}
