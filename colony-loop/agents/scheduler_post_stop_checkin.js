// SCHEDULER POST-STOP CHECK-IN
//
// Fires on SCHEDULER_POST_STOP_CHECKIN (emitted by job_completed.js
// right after a JOB_COMPLETED). SMSes the tech a quick "good to go?"
// check-in with a deep-link to /tech-scheduler.html. The scheduler
// chat opens with the conversation pre-seeded ("I just finished a
// job. What have I got left today?") so the tech doesn't have to
// type anything to get a status pull.
//
// Why: Teddy — "Scheduling ant should also check-in with technicians
// after each stop." This is the proactive nudge layer on top of the
// scheduler. Tech can tap the link to engage, OR just keep driving —
// the SMS itself contains the remaining-job count + next stop time.
//
// Gates:
//   - Skip if tech_id == 1 (owner Teddy — handled by his own flows)
//   - Skip if no more jobs left today (nothing to nudge about)
//   - Skip if after 7pm CT or before 6am CT (no after-hours pings)
//   - Skip if tech has no phone on file
//
// Signal dispatch dedup handles the "fire once per signal" guarantee
// — no extra event_log dedup needed.

const CT_TZ = 'America/Chicago';
const BASE_URL = 'https://tnapplianceexchange.net';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const techIdFromPayload = Number(payload.technician_id || 0);

  if (!techIdFromPayload) {
    await xano.markSignalProcessed(signal.id, 'scheduler_checkin_skipped', { reason: 'no_tech_id' });
    return { success: true, action: 'skipped_no_tech' };
  }
  if (techIdFromPayload === 1) {
    await xano.markSignalProcessed(signal.id, 'scheduler_checkin_skipped', { reason: 'owner_skip', tech_id: 1 });
    return { success: true, action: 'skipped_owner' };
  }

  // After-hours
  const nowHour = parseInt(new Date().toLocaleString('en-US', { timeZone: CT_TZ, hour: 'numeric', hour12: false }), 10);
  if (nowHour >= 19 || nowHour < 6) {
    await xano.markSignalProcessed(signal.id, 'scheduler_checkin_skipped', { reason: 'after_hours', hour: nowHour });
    return { success: true, action: 'skipped_after_hours' };
  }

  // Resolve tech (phone + first name)
  let tech = null;
  try {
    const all = await xano.getTechnicians();
    tech = (all || []).find((t) => Number(t.id) === techIdFromPayload) || null;
  } catch (_) {}
  if (!tech || !tech.phone) {
    await xano.markSignalProcessed(signal.id, 'scheduler_checkin_skipped', { reason: 'no_tech_phone', tech_id: techIdFromPayload });
    return { success: true, action: 'skipped_no_phone' };
  }

  // Pull tech's day → count remaining stops (excluding the one that
  // just completed). Today's date in CT.
  let remainingJobs = [];
  try {
    const dash = await xano.getTechDailyDashboard(techIdFromPayload);
    if (dash && Array.isArray(dash.jobs)) {
      const nowMs = Date.now();
      remainingJobs = dash.jobs.filter((entry) => {
        const j = entry.job || entry;
        if (!j) return false;
        if (j.id === jobId) return false;
        const start = Number(j.scheduled_start || 0);
        const status = String(j.scheduling_status || '').toLowerCase();
        if (['completed', 'canceled', 'cancelled', 'no_fix_possible'].includes(status)) return false;
        return start > nowMs - 30 * 60 * 1000;  // give a 30m grace for ones currently in progress
      });
    }
  } catch (_) {}

  if (remainingJobs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'scheduler_checkin_skipped', { reason: 'no_more_stops', tech_id: techIdFromPayload });
    return { success: true, action: 'skipped_no_more_stops' };
  }

  // Ahead-of-schedule detection: compare completion time vs the job's
  // scheduled_end. If finished 30+ min early AND there are more stops
  // later today, the SMS shifts to "want me to ask later customers if
  // they can come up?"
  let aheadMin = 0;
  try {
    const dash = await xano.getTechDailyDashboard(techIdFromPayload);
    const myDay = (dash && Array.isArray(dash.jobs)) ? dash.jobs : [];
    const completedEntry = myDay.find((e) => (e.job || e).id === jobId);
    if (completedEntry) {
      const cj = completedEntry.job || completedEntry;
      const schedEnd = Number(cj.scheduled_end || 0);
      if (schedEnd > 0) {
        aheadMin = Math.round((schedEnd - Date.now()) / 60000);
      }
    }
  } catch (_) {}
  const runningAhead = aheadMin >= 30;

  // Compose SMS
  const N = remainingJobs.length;
  let nextLine = '';
  const next = remainingJobs[0];
  const nextJob = next.job || next;
  const nextCust = next.customer || {};
  if (nextJob && nextJob.scheduled_start) {
    try {
      const t = new Date(Number(nextJob.scheduled_start)).toLocaleTimeString('en-US', {
        timeZone: CT_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
      });
      const custName = ((nextCust.first_name || '') + ' ' + (nextCust.last_name || '')).trim() || 'next customer';
      nextLine = ` Next: ${t} — ${custName}.`;
    } catch (_) {}
  }
  // Deep-link prompt adapts to detected state.
  const promptText = runningAhead
    ? `I just finished early — about ${aheadMin} minutes ahead. Want to ask my later customers today if any of them can come up earlier? Show me the candidates.`
    : 'I just finished a job. What have I got left today and how am I tracking?';
  const link = `${BASE_URL}/tech-scheduler.html?tech_id=${techIdFromPayload}&prompt=${encodeURIComponent(promptText)}`;

  const body = runningAhead
    ? `[ant] nice — wrapped ${aheadMin} min early. ${N} stop${N === 1 ? '' : 's'} left.${nextLine} Want me to ask any of them to move up? ${link}`
    : `[ant] wrapped — good to go? ${N} stop${N === 1 ? '' : 's'} left.${nextLine} Switch anything around: ${link}`;

  let smsResult;
  try {
    smsResult = await sms.toTech({
      tech_id: techIdFromPayload,
      phone: tech.phone,
      body,
      call_site: 'scheduler_post_stop_checkin',
    });
  } catch (e) {
    smsResult = { ok: false, error: String(e) };
  }

  await xano.markSignalProcessed(signal.id, 'scheduler_checkin_handled', {
    job_id: jobId,
    tech_id: techIdFromPayload,
    remaining_stops: N,
    sms_ok: !!(smsResult && smsResult.ok),
  });

  log('scheduler_checkin_sent', { job_id: jobId, tech_id: techIdFromPayload, remaining_stops: N });
  return { success: true, action: 'sent', remaining_stops: N };
}
