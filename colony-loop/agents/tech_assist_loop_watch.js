// Step 10 — Tech Assist Loop Watch (Phase 3 rollout monitor)
//
// Fires every 5 min via tick.js. Scans tech_assist_session rows for the
// 5 active techs (ids 2-6). Alerts Teddy when a session is older than
// 15 minutes AND has more than 5 messages AND status is not 'saved' or
// 'escalated' — likely an interrogation loop.
//
// Also auto-pauses tech assist for any tech who has hit 2+ loops today
// (logs via tech_assist_paused event_log row matching the PAUSE shortcut
// behavior in tech_preference_inbound).
import { config } from '../config.js';
import { toOwner } from '../sms.js';

const ACTIVE_TECH_IDS = [2, 3, 4, 5, 6];
const LOOP_AGE_MS = 15 * 60 * 1000;
const LOOP_MSG_COUNT = 5;
const AUTO_PAUSE_LOOP_COUNT = 2;

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const nowMs = Date.now();

  // Use the existing get_dead_letter_signals or similar — but we need a
  // tech_assist_session list endpoint. Fall back to per-tech lookups via
  // the tech_assist_session-by-(job,tech) endpoint that already exists.
  let alertCount = 0;
  let pausedCount = 0;

  for (const techId of ACTIVE_TECH_IDS) {
    let sessions;
    try {
      sessions = await xano.getTechSessionsForLoopWatch(techId, nowMs);
    } catch (err) {
      log('tech_assist_loop_watch_lookup_failed', { tech_id: techId, error: String(err.message || err) });
      continue;
    }
    const items = (sessions && sessions.items) || sessions || [];

    let loopCountToday = 0;
    for (const s of items) {
      const createdAt = Number(s.created_at) || 0;
      const ageMs = nowMs - createdAt;
      const msgCount = Number(s.message_count) || 0;
      const status = String(s.status || '').toLowerCase();

      const isLoop = ageMs > LOOP_AGE_MS
        && msgCount > LOOP_MSG_COUNT
        && status !== 'complete'
        && status !== 'escalated'
        && status !== 'abandoned';

      if (isLoop) {
        loopCountToday++;
        const techName = s.tech_first_name || `tech_${techId}`;
        const jobId = s.job_id || 0;
        const link = `${(config.publicSiteBase || '').replace(/^https?:\/\//, '')}/tech-ant-live.html?job_id=${jobId}&tech_id=${techId}`;
        const body = `WATCH: ${techName} session on job #${jobId} is at ${msgCount} msgs, ${Math.round(ageMs/60000)} min old, TDR not saved. Possible loop. ${link}`;
        try {
          await toOwner(body, {
            action: 'tech_assist_loop_alert',
            tech_id: techId,
            job_id: jobId,
            message_count: msgCount,
            age_ms: ageMs,
          });
          alertCount++;
        } catch (err) {
          log('tech_assist_loop_alert_send_failed', { tech_id: techId, error: String(err.message || err) });
        }
      }
    }

    // Auto-pause if tech hit 2+ loops today
    if (loopCountToday >= AUTO_PAUSE_LOOP_COUNT) {
      try {
        await xano.recordEventLog('tech_assist_paused', {
          tech_id: techId,
          paused_by: 0,
          reason: 'auto_paused_2_loops_today',
          loop_count: loopCountToday,
        });
        await toOwner(
          `AUTO-PAUSED tech_id ${techId} after ${loopCountToday} loops today. Investigate before RESUME TECH ASSIST FOR ${techId}.`,
          { action: 'tech_assist_auto_paused', tech_id: techId, loop_count: loopCountToday },
        );
        pausedCount++;
      } catch (err) {
        log('tech_assist_auto_pause_failed', { tech_id: techId, error: String(err.message || err) });
      }
    }
  }

  const meta = { outcome: 'loop_watch_done', alerts: alertCount, paused: pausedCount, checked: ACTIVE_TECH_IDS.length };
  await xano.markSignalProcessed(signal.id, 'tech_assist_loop_watch_handled', meta);
  log('tech_assist_loop_watch_handled', meta);

  return { success: true, action: meta.outcome, ...meta };
}
