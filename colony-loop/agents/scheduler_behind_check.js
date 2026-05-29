// SCHEDULER BEHIND CHECK
//
// Fires on SCHEDULER_BEHIND_CHECK (emitted by tick.js every 20 min
// during business hours). Scans active techs for jobs that are
// running long: tech tapped Start but the job's scheduled_end has
// passed by 30+ min AND there are more stops scheduled after that
// today.
//
// For each behind tech: SMSes the tech proactively — "looks like
// you're behind on the X job, want me to text your next customer?"
// Deep-link opens the scheduler chat already loaded with the offer.
//
// Why: Teddy — "Scheduling ant should recognize if a technician is
// running behind and say, hey, I see that you're running behind. Do
// you need me to message your customers for you?"
//
// Dedup: only ping a given (tech, job) pair once every 90 min. After
// that, if the tech is STILL behind, ping again with updated estimate.

const CT_TZ = 'America/Chicago';
const BASE_URL = 'https://tnapplianceexchange.net';
const MIN_BEHIND_MIN = 30;
const REPING_GAP_MIN = 90;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  const nowMs = Date.now();
  const nowHour = parseInt(new Date().toLocaleString('en-US', { timeZone: CT_TZ, hour: 'numeric', hour12: false }), 10);
  if (nowHour < 7 || nowHour >= 19) {
    await xano.markSignalProcessed(signal.id, 'scheduler_behind_check_skipped', { reason: 'after_hours', hour: nowHour });
    return { success: true, action: 'skipped_after_hours' };
  }

  let techs = [];
  try {
    const all = await xano.getTechnicians();
    techs = (all || []).filter((t) => Number(t.id) !== 1 && t.active === true && (t.phone || '').trim() !== '');
  } catch (_) {}
  if (techs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'scheduler_behind_check_skipped', { reason: 'no_active_techs' });
    return { success: true, action: 'skipped_no_techs' };
  }

  let nudged = 0;
  const skipped = [];

  for (const tech of techs) {
    const techId = Number(tech.id);
    try {
      const dash = await xano.getTechDailyDashboard(techId);
      const myDay = (dash && Array.isArray(dash.jobs)) ? dash.jobs : [];

      // Find a job that's IN PROGRESS (job_started_at set, job_completed_at null)
      // whose scheduled_end has passed by 30+ min.
      const stuck = myDay.find((entry) => {
        const j = entry.job || entry;
        if (!j) return false;
        const started = Number(j.job_started_at || 0);
        const completed = Number(j.job_completed_at || 0);
        if (!started || completed) return false;
        const schedEnd = Number(j.scheduled_end || 0);
        if (!schedEnd) return false;
        return nowMs - schedEnd >= MIN_BEHIND_MIN * 60000;
      });

      if (!stuck) {
        skipped.push({ tech_id: techId, reason: 'not_behind' });
        continue;
      }

      const stuckJob = stuck.job || stuck;
      const remainingAfter = myDay.filter((entry) => {
        const j = entry.job || entry;
        if (!j || j.id === stuckJob.id) return false;
        const start = Number(j.scheduled_start || 0);
        const status = String(j.scheduling_status || '').toLowerCase();
        if (['completed', 'canceled', 'cancelled', 'no_fix_possible'].includes(status)) return false;
        return start > Number(stuckJob.scheduled_end || 0);
      });
      if (remainingAfter.length === 0) {
        skipped.push({ tech_id: techId, reason: 'no_jobs_after_stuck' });
        continue;
      }

      // Dedup per (tech, job) — 90 min reping window
      const dedupAction = `scheduler_behind_pinged_${techId}_${stuckJob.id}`;
      let recentlyPinged = false;
      try {
        const recent = await xano.listRecentEventLog({ action: dedupAction, days_back: 1, limit: 1 });
        if (recent && recent.length > 0) {
          const last = Number(recent[0].created_at || 0);
          if (last && nowMs - last < REPING_GAP_MIN * 60000) recentlyPinged = true;
        }
      } catch (_) {}
      if (recentlyPinged) {
        skipped.push({ tech_id: techId, reason: 'pinged_recently', job_id: stuckJob.id });
        continue;
      }

      const overMin = Math.round((nowMs - Number(stuckJob.scheduled_end || 0)) / 60000);
      const N = remainingAfter.length;

      const promptText = `I'm running about ${overMin} minutes behind on the current job. I have ${N} more stop${N === 1 ? '' : 's'} after this. Draft a running-behind SMS for each remaining customer with updated ETAs.`;
      const link = `${BASE_URL}/tech-scheduler.html?tech_id=${techId}&prompt=${encodeURIComponent(promptText)}`;
      const firstName = (tech.first_name || 'there').trim();
      const body = `[ant] heads up ${firstName} — looks like you're ${overMin}m behind. ${N} stop${N === 1 ? '' : 's'} after this. Want me to message your next customer(s) for you? ${link}`;

      const smsResult = await sms.toTech({
        tech_id: techId,
        phone: tech.phone,
        body,
        call_site: 'scheduler_behind_check',
      }).catch((e) => ({ ok: false, error: String(e) }));

      if (smsResult && smsResult.ok) {
        nudged += 1;
        try { await xano.recordEvent(dedupAction, { job_id: stuckJob.id, over_min: overMin, remaining: N }); } catch (_) {}
      } else {
        skipped.push({ tech_id: techId, reason: 'sms_failed', error: smsResult && smsResult.error });
      }
    } catch (e) {
      skipped.push({ tech_id: techId, reason: 'loop_error', error: e.message });
    }
  }

  await xano.markSignalProcessed(signal.id, 'scheduler_behind_check_handled', {
    techs_total: techs.length,
    nudged,
    skipped,
  });

  log('scheduler_behind_check_done', { nudged, skipped_count: skipped.length });
  return { success: true, action: 'done', nudged };
}
