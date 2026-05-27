import { config } from './config.js';
import * as xano from './xano.js';
import { dispatch } from './dispatch.js';
import { ctMidnightMs, ctHour, fmtCT } from './time.js';
import * as sms from './sms.js';
import * as claude from './claude.js';
import { escalate } from './escalate.js';

let running = false;
let lastHeartbeat = 0;
const HEARTBEAT_MS = 5 * 60 * 1000;
const LOOP_STARTED_AT = Date.now();

export async function tick() {
  if (running) {
    xano.logLocal('tick_skipped_overlap');
    return;
  }
  running = true;
  const t0 = Date.now();
  let processed = 0;
  let errors = 0;

  try {
    await maybeEmitTimeSignals();

    const signals = await xano.fetchPendingSignals();
    for (const sig of signals) {
      try {
        xano.logLocal('signal_dispatched', { signal_id: sig.id, signal_type: sig.signal_type });
        const result = await dispatch(sig, makeCtx());
        await xano.markSignalProcessed(sig.id, 'signal_processed', {
          signal_type: sig.signal_type,
          ...summarize(result),
        });
        processed++;
      } catch (err) {
        errors++;
        xano.logLocal('signal_error', {
          signal_id: sig.id,
          signal_type: sig.signal_type,
          error: err.message,
          stack: (err.stack || '').slice(0, 500),
        });
        await xano.markSignalProcessed(sig.id, 'signal_error', {
          signal_type: sig.signal_type,
          error: err.message,
        });
      }
    }

    const now = Date.now();
    if (processed > 0 || errors > 0 || now - lastHeartbeat > HEARTBEAT_MS) {
      xano.logLocal('loop_tick', {
        tick_ms: now - t0,
        signals_processed: processed,
        errors,
        colony: config.colonyName,
        ct: fmtCT(now),
      });

      // Persist a heartbeat to Xano event_log so the standalone healthcheck
      // script can detect liveness independently of the loop's own process.
      // Throttled to once per HEARTBEAT_MS window (matches local log cadence).
      if (now - lastHeartbeat > HEARTBEAT_MS || lastHeartbeat === 0) {
        try {
          await xano.recordHeartbeat({
            colony: config.colonyName,
            uptime_ms: now - LOOP_STARTED_AT,
            signals_processed_in_window: processed,
          });
        } catch (err) {
          xano.logLocal('heartbeat_write_failed', { error: err.message });
        }
      }

      lastHeartbeat = now;
    }
  } catch (err) {
    xano.logLocal('loop_error', {
      error: err.message,
      stack: (err.stack || '').slice(0, 500),
    });
  } finally {
    running = false;
  }
}

async function maybeEmitTimeSignals() {
  const nowTs = Date.now();
  const hour = ctHour(nowTs);
  const sinceMs = ctMidnightMs(nowTs);

  // COLONY_ARCHITECT — fires once per day at 6am CT (6-9am grace window).
  // Before the tech briefings. Builds the next eligible TO_BUILD agent
  // from docs/appliance-ant-master-blueprint.json. Default max_builds=1
  // per scheduled run; on-demand injections can request more.
  if (hour >= 6 && hour < 9) {
    let archFired;
    try {
      archFired = await xano.getColonyArchitectFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('colony_architect_check_failed', { error: err.message });
      archFired = null;
    }
    if (archFired && !archFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'COLONY_ARCHITECT',
          signal_strength: 70,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs), max_builds: 999 },
        });
        xano.logLocal('colony_architect_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('colony_architect_emit_failed', { error: err.message });
      }
    }
  }

  // DAILY_JOB_PREP — fires once per day at 6:30am CT (6-9am grace window).
  // Sends Teddy a consolidated list of undiagnosed jobs in next 3 days +
  // each tech their own. Goal: parts ordered before first visit.
  if (hour >= 6 && hour < 9) {
    let jobPrepFired;
    try {
      jobPrepFired = await xano.getDailyJobPrepFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('daily_job_prep_check_failed', { error: err.message });
      jobPrepFired = null;
    }
    if (jobPrepFired && !jobPrepFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'DAILY_JOB_PREP',
          signal_strength: 80,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs), days_ahead: 3 },
        });
        xano.logLocal('daily_job_prep_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('daily_job_prep_emit_failed', { error: err.message });
      }
    }
  }

  // DAILY_TECH_BRIEFING — fires once per day at 7am CT (7-10am grace window
  // covers Mac Mini wake/restart). Per-tech fan-out happens inside the agent.
  if (hour >= 7 && hour < 10) {
    let techFired;
    try {
      techFired = await xano.getDailyTechBriefingFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('daily_tech_briefing_check_failed', { error: err.message });
      techFired = null;
    }
    if (techFired && !techFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'DAILY_TECH_BRIEFING',
          signal_strength: 80,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        xano.logLocal('daily_tech_briefing_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('daily_tech_briefing_emit_failed', { error: err.message });
      }
    }
  }

  // DAILY_REVENUE_SUMMARY — fires once per day at 6pm CT (6-9pm grace).
  // EOD digest of completed-jobs volume + warranty/self-pay split + per-tech.
  if (hour >= 18 && hour < 21) {
    let revFired;
    try {
      revFired = await xano.getDailyRevenueFired(sinceMs);
    } catch (err) {
      xano.logLocal('daily_revenue_dedup_failed', { error: err.message });
      revFired = null;
    }
    if (revFired && !revFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'DAILY_REVENUE_SUMMARY',
          signal_strength: 65,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        xano.logLocal('daily_revenue_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('daily_revenue_emit_failed', { error: err.message });
      }
    }
  }

  // CAPACITY_CHECK — fires once per day at 10am CT (10am-12pm grace).
  // Alerts Teddy when any tech has >6 jobs (overload) or <2 jobs (idle).
  if (hour >= 10 && hour < 12) {
    let capFired;
    try {
      capFired = await xano.getCapacityCheckFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('capacity_check_dedup_failed', { error: err.message });
      capFired = null;
    }
    if (capFired && !capFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'CAPACITY_CHECK',
          signal_strength: 55,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        xano.logLocal('capacity_check_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('capacity_check_emit_failed', { error: err.message });
      }
    }
  }

  // RESUME_NUDGE — fires once per day at 9:30am CT (9-12 grace). Sweeps
  // AHS/ServicePower jobs with no resume-chat completion within 48h
  // (single nudge per job, dedup'd via compound action key).
  if (hour >= 9 && hour < 12) {
    let resumeFired;
    try {
      resumeFired = await xano.getResumeNudgeFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('resume_nudge_dedup_failed', { error: err.message });
      resumeFired = null;
    }
    if (resumeFired && !resumeFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'RESUME_NUDGE',
          signal_strength: 55,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        xano.logLocal('resume_nudge_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('resume_nudge_emit_failed', { error: err.message });
      }
    }
  }

  // UNPAID_SELF_PAY_DIGEST — fires once per day at 10:30am CT (10-13 grace).
  // Sends Teddy a digest of self-pay jobs completed in the last 14 days
  // where payment_collected is still false. Silent skip when all paid.
  if (hour >= 10 && hour < 13) {
    let unpaidFired;
    try {
      unpaidFired = await xano.getUnpaidDigestFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('unpaid_digest_dedup_failed', { error: err.message });
      unpaidFired = null;
    }
    if (unpaidFired && !unpaidFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'UNPAID_SELF_PAY_DIGEST',
          signal_strength: 50,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        xano.logLocal('unpaid_self_pay_digest_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('unpaid_self_pay_digest_emit_failed', { error: err.message });
      }
    }
  }

  // TDR_REMINDER — fires once per day at 4pm CT (4-7pm grace). For each
  // tech with at least one job completed today missing a full TDR, SMS
  // the tech with the open-job list + a deep link to tech-daily-dashboard.
  if (hour >= 16 && hour < 19) {
    let tdrFired;
    try {
      tdrFired = await xano.getTdrReminderFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('tdr_reminder_dedup_failed', { error: err.message });
      tdrFired = null;
    }
    if (tdrFired && !tdrFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'TDR_REMINDER',
          signal_strength: 55,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        xano.logLocal('tdr_reminder_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('tdr_reminder_emit_failed', { error: err.message });
      }
    }
  }

  // PARTS_ARRIVAL_CHECK — fires once per day at 11am CT (11am-1pm grace).
  // Sweeps jobs in awaiting_parts status with parts_eta_date <= today and
  // SMSes each customer asking for a re-visit time. Per-job dedup handled
  // inside the agent via event_log compound action key.
  if (hour >= 11 && hour < 13) {
    let partsFired;
    try {
      partsFired = await xano.getPartsArrivalCheckFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('parts_arrival_check_dedup_failed', { error: err.message });
      partsFired = null;
    }
    if (partsFired && !partsFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'PARTS_ARRIVAL_CHECK',
          signal_strength: 60,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        xano.logLocal('parts_arrival_check_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('parts_arrival_check_emit_failed', { error: err.message });
      }
    }
  }

  // SCHEDULE_GAP_CHECK — fires once per day at 9am CT (9-11am grace window,
  // after the briefings). Scans today's calendar for 2+ hour gaps per tech
  // and SMSes Teddy with the opportunity list + AHS-backlog candidates.
  if (hour >= 9 && hour < 11) {
    let gapFired;
    try {
      gapFired = await xano.getScheduleGapCheckFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('schedule_gap_check_dedup_failed', { error: err.message });
      gapFired = null;
    }
    if (gapFired && !gapFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'SCHEDULE_GAP_CHECK',
          signal_strength: 60,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        xano.logLocal('schedule_gap_check_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('schedule_gap_check_emit_failed', { error: err.message });
      }
    }
  }

  // WEEKLY_PERFORMANCE_SUMMARY — fires once per week on Sundays 8-11am CT.
  // Fans out PERFORMANCE_REQUEST_* signals per tech × per scope so each
  // tech's metrics get refreshed once per week. Uses since_ts_ms = start
  // of current week (Sunday CT midnight) for dedup.
  try {
    const dayOfWeekCT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (dayOfWeekCT === 'Sun' && hour >= 8 && hour < 11) {
      // Use today's CT midnight as the week start (Sunday midnight) since
      // we only fire on Sundays.
      let weeklyFired;
      try {
        weeklyFired = await xano.getWeeklyPerformanceFired(sinceMs);
      } catch (err) {
        xano.logLocal('weekly_performance_check_failed', { error: err.message });
        weeklyFired = null;
      }
      if (weeklyFired && !weeklyFired.fired) {
        try {
          await xano.emitSignal({
            signal_type: 'WEEKLY_PERFORMANCE_SUMMARY',
            signal_strength: 70,
            payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
          });
          xano.logLocal('weekly_performance_emitted', { since_ts_ms: sinceMs });
        } catch (err) {
          xano.logLocal('weekly_performance_emit_failed', { error: err.message });
        }
      }
    }
  } catch (err) {
    xano.logLocal('weekly_performance_dow_check_failed', { error: err.message });
  }

  // DAILY_BRIEFING — owner morning briefing, 8-11am CT window.
  if (hour < 8 || hour >= 11) return;

  let fired;
  try {
    fired = await xano.getDailyBriefingFiredToday(sinceMs);
  } catch (err) {
    xano.logLocal('daily_briefing_check_failed', { error: err.message });
    return;
  }
  if (fired && fired.fired) return;

  await xano.emitSignal({
    signal_type: 'DAILY_BRIEFING',
    signal_strength: 80,
    payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
  });
  xano.logLocal('daily_briefing_emitted', { since_ts_ms: sinceMs });
}

function summarize(result) {
  if (!result || typeof result !== 'object') return {};
  const keys = ['success', 'action', 'confidence', 'attachments_count', 'phone', 'job_id', 'reason', 'total_owed', 'tech_id'];
  const out = {};
  for (const k of keys) if (k in result) out[k] = result[k];
  return out;
}

function makeCtx() {
  return {
    xano,
    sms,
    claude,
    escalate,
    config,
    log: (action, metadata) => xano.logLocal(action, metadata),
  };
}
