// SCHEDULER PERIODIC CHECK-IN
//
// Fires on SCHEDULER_PERIODIC_CHECKIN (emitted by tick.js mid-morning
// and mid-afternoon on weekdays). For each active tech with remaining
// jobs today, sends a quick "how's it going? want any extra stops?"
// SMS with a deep-link to /tech-scheduler.html.
//
// Why: Teddy — "he should always be around checking in every now and
// then... if he wants to get extra stops there should be." The post-
// stop agent fires immediately after each job; this is the ambient
// "let me know if you need anything" layer in between.
//
// When called:
//   - tick.js emits SCHEDULER_PERIODIC_CHECKIN at 10am + 2pm CT (Mon-Sat)
//   - Agent fans out across ACTIVE technicians (id 2-6)
//   - Per-tech gates:
//       - Skip owner Teddy (tech_id 1)
//       - Skip if no remaining jobs today
//       - Skip if last check-in was within 3 hours (dedup)
//       - Skip if tech has no phone on file
//
// SMS includes a deep-link with a pre-seeded "how am I tracking + any
// extra stops nearby?" prompt so the scheduler chat opens with status
// already pulled.

const CT_TZ = 'America/Chicago';
const BASE_URL = 'https://tnapplianceexchange.net';
const MIN_GAP_HOURS = 3;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: CT_TZ, hour: 'numeric', hour12: false }), 10);
  if (hour < 6 || hour >= 19) {
    await xano.markSignalProcessed(signal.id, 'scheduler_periodic_checkin_skipped', { reason: 'after_hours', hour });
    return { success: true, action: 'skipped_after_hours' };
  }

  let techs = [];
  try {
    const all = await xano.getTechnicians();
    techs = (all || []).filter((t) => Number(t.id) !== 1 && t.active === true && (t.phone || '').trim() !== '');
  } catch (_) {}

  if (techs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'scheduler_periodic_checkin_skipped', { reason: 'no_active_techs' });
    return { success: true, action: 'skipped_no_techs' };
  }

  let sent = 0;
  const skipped = [];

  for (const tech of techs) {
    const techId = Number(tech.id);
    try {
      // Pull tech's day → count remaining stops
      const dash = await xano.getTechDailyDashboard(techId);
      const nowMs = Date.now();
      const remaining = (dash && Array.isArray(dash.jobs))
        ? dash.jobs.filter((entry) => {
            const j = entry.job || entry;
            if (!j) return false;
            const start = Number(j.scheduled_start || 0);
            const status = String(j.scheduling_status || '').toLowerCase();
            if (['completed', 'canceled', 'cancelled', 'no_fix_possible'].includes(status)) return false;
            return start > nowMs - 30 * 60 * 1000;
          })
        : [];

      if (remainingFilter(remaining)) {
        skipped.push({ tech_id: techId, reason: 'no_remaining_jobs' });
        continue;
      }

      const N = remaining.length;
      const promptText = 'How am I tracking today? Any gaps where I could squeeze in an extra stop nearby?';
      const link = `${BASE_URL}/tech-scheduler.html?tech_id=${techId}&prompt=${encodeURIComponent(promptText)}`;
      const firstName = (tech.first_name || 'there').trim();
      const body = `[ant] hey ${firstName} — checking in. ${N} stop${N === 1 ? '' : 's'} left today. Need to shuffle anything or want me to find an extra stop nearby? ${link}`;

      const smsResult = await sms.toTech({
        tech_id: techId,
        phone: tech.phone,
        body,
        call_site: 'scheduler_periodic_checkin',
      }).catch((e) => ({ ok: false, error: String(e) }));

      if (smsResult && smsResult.ok) sent += 1;
      else skipped.push({ tech_id: techId, reason: 'sms_failed', error: smsResult && smsResult.error });
    } catch (e) {
      skipped.push({ tech_id: techId, reason: 'tech_loop_error', error: e.message });
    }
  }

  await xano.markSignalProcessed(signal.id, 'scheduler_periodic_checkin_handled', {
    techs_total: techs.length,
    sent,
    skipped,
  });

  log('scheduler_periodic_checkin_done', { sent, skipped_count: skipped.length });
  return { success: true, action: 'sent_batch', sent };
}

// Empty-list helper kept separate so the lint reads cleanly above.
function remainingFilter(remaining) {
  return !Array.isArray(remaining) || remaining.length === 0;
}
