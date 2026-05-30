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
        // Carve out the no-agent-yet case so dead-letter analysis can
        // query event_log.action == 'signal_no_agent_yet' directly (no
        // JSON-decode of metadata needed). Everything else still lands
        // as 'signal_processed'.
        const isNoAgent = result && result.action === 'no_agent_yet';
        await xano.markSignalProcessed(
          sig.id,
          isNoAgent ? 'signal_no_agent_yet' : 'signal_processed',
          {
            signal_type: sig.signal_type,
            ...summarize(result),
          }
        );
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
      //
      // 2026-05-30 fix: lastHeartbeat = now used to be outside this if-block,
      // which meant every tick with processed signals updated the timestamp
      // even when no heartbeat was written. Result: inner condition was
      // always false in active production, heartbeats stopped firing, and
      // the healthcheck SMS-spammed Teddy for 2 days with stale event_id
      // references. Assignment now lives INSIDE the inner block so it only
      // moves forward when a heartbeat actually wrote.
      if (now - lastHeartbeat > HEARTBEAT_MS || lastHeartbeat === 0) {
        try {
          await xano.recordHeartbeat({
            colony: config.colonyName,
            uptime_ms: now - LOOP_STARTED_AT,
            signals_processed_in_window: processed,
          });
          lastHeartbeat = now;
        } catch (err) {
          xano.logLocal('heartbeat_write_failed', { error: err.message });
        }
      }
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
        try { await xano.recordEventLog('colony_architect_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
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
        try { await xano.recordEventLog('daily_job_prep_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
      } catch (err) {
        xano.logLocal('daily_job_prep_emit_failed', { error: err.message });
      }
    }
  }

  // CLUSTER_ROUTE_MORNING_CHECK — daily 6:45am CT (6-8 grace).
  // Surfaces route inefficiencies before trucks roll: outlier stops,
  // backtracks, far-flung days. Dedup via check_event_log_fired_today.
  if (hour >= 6 && hour < 8) {
    const dateCt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowTs));
    let firedAlready = false;
    try { firedAlready = await xano.checkEventLogFiredToday('cluster_route_morning_check_emitted', dateCt); } catch (_) {}
    if (!firedAlready) {
      try {
        await xano.emitSignal({
          signal_type: 'CLUSTER_ROUTE_MORNING_CHECK',
          signal_strength: 45,
          payload: { day: dateCt, emitted_ct: fmtCT(nowTs) },
        });
        await xano.recordEvent('cluster_route_morning_check_emitted', { day: dateCt });
      } catch (err) {
        xano.logLocal('cluster_route_morning_check_emit_failed', { error: err.message });
      }
    }
  }

  // SCHEDULER_BEHIND_CHECK — fires every 20 min during business hours
  // (7am-7pm CT). Scans active techs for jobs running 30+ min past
  // their scheduled_end. Each agent run is idempotent per-(tech,job).
  if (hour >= 7 && hour < 19) {
    const minute = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', minute: '2-digit', hour12: false }).format(new Date(nowTs)), 10);
    // Fire at minute 0, 20, 40 (every 20 minutes)
    if (minute === 0 || minute === 20 || minute === 40) {
      const slot = `${hour.toString().padStart(2,'0')}_${minute.toString().padStart(2,'0')}`;
      const dateCt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowTs));
      const dayKey = `${dateCt}_${slot}`;
      let firedAlready = false;
      try { firedAlready = await xano.checkEventLogFiredToday('scheduler_behind_check_emitted', dayKey); } catch (_) {}
      if (!firedAlready) {
        try {
          await xano.emitSignal({
            signal_type: 'SCHEDULER_BEHIND_CHECK',
            signal_strength: 50,
            payload: { slot, emitted_ct: fmtCT(nowTs) },
          });
          await xano.recordEvent('scheduler_behind_check_emitted', { day: dayKey, slot });
        } catch (err) {
          xano.logLocal('scheduler_behind_check_emit_failed', { error: err.message });
        }
      }
    }
  }

  // SCHEDULER_PERIODIC_CHECKIN — fires Mon-Sat at 10am CT and 2pm CT.
  // Per-tech check-in: "how's it going, want any extra stops?"
  // Dedup via check_event_log_fired_today so multiple ticks within
  // the hour don't multi-emit.
  {
    const dayShort = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    const dateCt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowTs));
    const isWeekday = dayShort !== 'Sun';
    let windowSlot = null;
    if (isWeekday && hour === 10) windowSlot = 'morning';
    else if (isWeekday && hour === 14) windowSlot = 'afternoon';
    if (windowSlot) {
      const dayKey = `${dateCt}_${windowSlot}`;
      let fired = false;
      try {
        fired = await xano.checkEventLogFiredToday('scheduler_periodic_checkin_emitted', dayKey);
      } catch (_) {}
      if (!fired) {
        try {
          await xano.emitSignal({
            signal_type: 'SCHEDULER_PERIODIC_CHECKIN',
            signal_strength: 40,
            payload: { window: windowSlot, day: dateCt, emitted_ct: fmtCT(nowTs) },
          });
          await xano.recordEvent('scheduler_periodic_checkin_emitted', { day: dayKey, window: windowSlot });
        } catch (err) {
          xano.logLocal('scheduler_periodic_checkin_emit_failed', { error: err.message });
        }
      }
    }
  }

  // WARRANTY_LEARNING_AGGREGATE — fires daily at 5am CT (5-7am grace
  // window). Reads recent warranty_correction events, detects patterns,
  // writes warranty_requirement_override rows. Agent idempotency via
  // check_event_log_fired_today so multiple grace-window ticks are safe.
  if (hour >= 5 && hour < 7) {
    try {
      await xano.emitSignal({
        signal_type: 'WARRANTY_LEARNING_AGGREGATE',
        signal_strength: 60,
        payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
      });
    } catch (err) {
      xano.logLocal('warranty_learning_emit_failed', { error: err.message });
    }
  }

  // CUSTOMER_INTEL_REFRESH — fires nightly at 10:30pm CT (22-23 grace).
  // Materialized view: channel_pref + comms_style + preferred_language
  // + abuse_score per customer. Replaces 3-4 separate live lookups
  // across customer-direction agents. Intelligence #5.
  if (hour >= 22 && hour < 24) {
    try {
      const fired = await xano.checkEventLogFiredToday({
        action: 'customer_intel_refresh_handled',
        since_ts_ms: sinceMs,
      }).catch(() => ({ fired_today: false }));
      if (!fired || !fired.fired_today) {
        await xano.emitSignal({
          signal_type: 'CUSTOMER_INTEL_REFRESH',
          signal_strength: 50,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      }
    } catch (err) {
      xano.logLocal('customer_intel_refresh_emit_failed', { error: err.message });
    }
  }

  // PRE_JOB_INTELLIGENCE_PRESTAGER — fires nightly at 9:30pm CT (21-23 grace).
  // For every job scheduled for tomorrow, runs the similar-jobs lookup +
  // channel preference + warranty hints and caches the distilled
  // summary in event_log. Tech Assist reads it at first session in the
  // morning. Overnight compute that would otherwise hit techs at
  // 7:30am. Intelligence #5.
  if (hour >= 21 && hour < 23) {
    try {
      const fired = await xano.checkEventLogFiredToday({
        action: 'pre_job_intelligence_prestager_handled',
        since_ts_ms: sinceMs,
      }).catch(() => ({ fired_today: false }));
      if (!fired || !fired.fired_today) {
        await xano.emitSignal({
          signal_type: 'PRE_JOB_INTELLIGENCE_PRESTAGER',
          signal_strength: 50,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      }
    } catch (err) {
      xano.logLocal('pre_job_intelligence_prestager_emit_failed', { error: err.message });
    }
  }

  // CAPABILITY_GAP_TO_BLUEPRINT — fires daily 5-8am CT.
  // Reads brain_capability_gap events from last 14d, groups by normalized
  // signature, when ≥3 hits writes the spec into the blueprint as
  // TO_BUILD. Architect's 6am run picks it up. Intelligence #8.
  if (hour >= 5 && hour < 8) {
    try {
      const fired = await xano.checkEventLogFiredToday({
        action: 'capability_gap_to_blueprint_handled',
        since_ts_ms: sinceMs,
      }).catch(() => ({ fired_today: false }));
      if (!fired || !fired.fired_today) {
        await xano.emitSignal({
          signal_type: 'CAPABILITY_GAP_TO_BLUEPRINT',
          signal_strength: 55,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      }
    } catch (err) {
      xano.logLocal('capability_gap_to_blueprint_emit_failed', { error: err.message });
    }
  }

  // WARRANTY_FINGERPRINT_AGGREGATOR — fires daily at 4:30am CT (4-6 grace).
  // Per-vendor behavioral fingerprint (60d window): claims_count,
  // clear_rate, rejection_rate, top correction fields. Tech Assist
  // + the warranty_router read this to pre-collect exactly the
  // fields THIS vendor rejects without. Intelligence #4.
  if (hour >= 4 && hour < 6) {
    try {
      const fired = await xano.checkEventLogFiredToday({
        action: 'warranty_fingerprint_aggregator_handled',
        since_ts_ms: sinceMs,
      }).catch(() => ({ fired_today: false }));
      if (!fired || !fired.fired_today) {
        await xano.emitSignal({
          signal_type: 'WARRANTY_FINGERPRINT_AGGREGATOR',
          signal_strength: 55,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      }
    } catch (err) {
      xano.logLocal('warranty_fingerprint_aggregator_emit_failed', { error: err.message });
    }
  }

  // BRAIN_CAPABILITY_GAP_DIGEST — Sunday 5pm CT (5-7pm grace). Reads
  // last 7 days of brain_capability_gap events, summarizes by brain +
  // gap, sends Teddy a digest. Architect ingests the gaps next run.
  {
    const dayShortGap = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (dayShortGap === 'Sun' && hour >= 17 && hour < 19) {
      try {
        await xano.emitSignal({
          signal_type: 'BRAIN_CAPABILITY_GAP_DIGEST',
          signal_strength: 50,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      } catch (err) {
        xano.logLocal('brain_capability_gap_digest_emit_failed', { error: err.message });
      }
    }
  }

  // SPEND_ANOMALY_DETECTOR — daily 11pm CT (23-25=23 only). Compares
  // today's spend vs 7d baseline + warns at 80% of hard cap.
  if (hour === 23) {
    try {
      const fired = await xano.checkEventLogFiredToday({
        action: 'spend_anomaly_handled',
        since_ts_ms: sinceMs,
      }).catch(() => ({ fired_today: false }));
      if (!fired || !fired.fired_today) {
        await xano.emitSignal({
          signal_type: 'SPEND_ANOMALY_DETECTOR',
          signal_strength: 40,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      }
    } catch (err) {
      xano.logLocal('spend_anomaly_emit_failed', { error: err.message });
    }
  }

  // WARRANTY_DENIAL_PATTERN_DETECTOR — daily 6pm CT (18-20 grace).
  // Surfaces vendors whose denial-rate exceeded threshold over 14d.
  if (hour >= 18 && hour < 20) {
    try {
      const fired = await xano.checkEventLogFiredToday({
        action: 'warranty_denial_pattern_handled',
        since_ts_ms: sinceMs,
      }).catch(() => ({ fired_today: false }));
      if (!fired || !fired.fired_today) {
        await xano.emitSignal({
          signal_type: 'WARRANTY_DENIAL_PATTERN_DETECTOR',
          signal_strength: 45,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      }
    } catch (err) {
      xano.logLocal('warranty_denial_emit_failed', { error: err.message });
    }
  }

  // APPOINTMENT_NO_SHOW_PREDICTOR — daily 6:30pm CT. Scores tomorrow's
  // appointments for no-show risk; surfaces top high-risk ones.
  if (hour >= 18 && hour < 20) {
    try {
      const fired = await xano.checkEventLogFiredToday({
        action: 'no_show_predictor_handled',
        since_ts_ms: sinceMs,
      }).catch(() => ({ fired_today: false }));
      if (!fired || !fired.fired_today) {
        await xano.emitSignal({
          signal_type: 'APPOINTMENT_NO_SHOW_PREDICTOR',
          signal_strength: 45,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      }
    } catch (err) {
      xano.logLocal('no_show_predictor_emit_failed', { error: err.message });
    }
  }

  // TECH_PERFORMANCE_ALERT — Sunday 11am CT (11-1pm grace). Compares
  // each tech's 7d vs 30d performance, alerts Teddy on significant
  // drops (FVFR, callback, rating, TDR completeness).
  {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (day === 'Sun' && hour >= 11 && hour < 13) {
      try {
        const fired = await xano.checkEventLogFiredToday({
          action: 'tech_performance_alert_handled',
          since_ts_ms: sinceMs,
        }).catch(() => ({ fired_today: false }));
        if (!fired || !fired.fired_today) {
          await xano.emitSignal({
            signal_type: 'TECH_PERFORMANCE_ALERT',
            signal_strength: 45,
            payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
          });
        }
      } catch (err) {
        xano.logLocal('tech_performance_alert_emit_failed', { error: err.message });
      }
    }
  }

  // CUSTOMER_RE_ENGAGEMENT — Tuesday 10am CT (10-12 grace). Pings
  // 6-12-month-old completed-job customers with personalized
  // maintenance-check SMS. Capped 25/run. Revenue play.
  {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (day === 'Tue' && hour >= 10 && hour < 12) {
      try {
        const fired = await xano.checkEventLogFiredToday({
          action: 'customer_re_engagement_handled',
          since_ts_ms: sinceMs,
        }).catch(() => ({ fired_today: false }));
        if (!fired || !fired.fired_today) {
          await xano.emitSignal({
            signal_type: 'CUSTOMER_RE_ENGAGEMENT',
            signal_strength: 35,
            payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
          });
        }
      } catch (err) {
        xano.logLocal('customer_re_engagement_emit_failed', { error: err.message });
      }
    }
  }

  // WEEKLY_DANIELLE_RECEIPT — Friday 5pm CT (17-19 grace). Counts the
  // week's automation outputs + estimates time saved. SMSes Teddy ONE
  // forwardable text. Parallel-run pattern for Danielle adoption.
  {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (day === 'Fri' && hour >= 17 && hour < 19) {
      try {
        const fired = await xano.checkEventLogFiredToday({
          action: 'weekly_danielle_receipt_handled',
          since_ts_ms: sinceMs,
        }).catch(() => ({ fired_today: false }));
        if (!fired || !fired.fired_today) {
          await xano.emitSignal({
            signal_type: 'WEEKLY_DANIELLE_RECEIPT',
            signal_strength: 40,
            payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
          });
        }
      } catch (err) {
        xano.logLocal('weekly_danielle_receipt_emit_failed', { error: err.message });
      }
    }
  }

  // STUCK_JOB_DETECTOR — daily 8:15am CT (8-10 grace). Scans every
  // non-terminal status for jobs sitting too long; SMSes Teddy a
  // digest of the worst offenders.
  if (hour >= 8 && hour < 10) {
    try {
      const fired = await xano.checkEventLogFiredToday({
        action: 'stuck_job_detector_handled',
        since_ts_ms: sinceMs,
      }).catch(() => ({ fired_today: false }));
      if (!fired || !fired.fired_today) {
        await xano.emitSignal({
          signal_type: 'STUCK_JOB_DETECTOR',
          signal_strength: 50,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      }
    } catch (err) {
      xano.logLocal('stuck_job_detector_emit_failed', { error: err.message });
    }
  }

  // PROMPT_EVOLUTION_PROPOSER — Sunday 7pm CT (7-9pm grace). Reads 14d
  // of claude_call_outcome, finds failing (brain, signal_type) cells,
  // proposes concrete prompt revisions. SMSes Teddy a digest.
  // Closes the outcome-learning loop into actionable prompt updates.
  {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (day === 'Sun' && hour >= 19 && hour < 21) {
      try {
        const fired = await xano.checkEventLogFiredToday({
          action: 'prompt_evolution_handled',
          since_ts_ms: sinceMs,
        }).catch(() => ({ fired_today: false }));
        if (!fired || !fired.fired_today) {
          await xano.emitSignal({
            signal_type: 'PROMPT_EVOLUTION_PROPOSER',
            signal_strength: 45,
            payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
          });
        }
      } catch (err) {
        xano.logLocal('prompt_evolution_emit_failed', { error: err.message });
      }
    }
  }

  // CLAUDE_OUTCOME_DIGEST — Sunday 6pm CT (6-9pm grace). Reads last 7
  // days of claude_call_outcome events and reports brain hit rates so
  // Teddy can see which (brain, signal_type) cells are producing real
  // results vs. theater. Outcome-conditioned learning loop (#1).
  {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (day === 'Sun' && hour >= 18 && hour < 21) {
      try {
        const fired = await xano.checkEventLogFiredToday({
          action: 'claude_outcome_digest_handled',
          since_ts_ms: sinceMs,
        }).catch(() => ({ fired_today: false }));
        if (!fired || !fired.fired_today) {
          await xano.emitSignal({
            signal_type: 'CLAUDE_OUTCOME_DIGEST',
            signal_strength: 45,
            payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
          });
        }
      } catch (err) {
        xano.logLocal('claude_outcome_digest_emit_failed', { error: err.message });
      }
    }
  }

  // WARRANTY_CONSOLIDATION_REVIEW — Sunday 4pm CT (4-6pm grace). Weekly
  // digest SMS to Teddy listing all live overrides written by the
  // aggregator over the past 7 days. He reviews + decides whether to
  // roll into the JSON baseline via /warranty-learning.html.
  {
    const dayShort = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (dayShort === 'Sun' && hour >= 16 && hour < 18) {
      try {
        await xano.emitSignal({
          signal_type: 'WARRANTY_CONSOLIDATION_REVIEW',
          signal_strength: 55,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      } catch (err) {
        xano.logLocal('warranty_consolidation_emit_failed', { error: err.message });
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
        try { await xano.recordEventLog('daily_tech_briefing_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
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
        try { await xano.recordEventLog('daily_revenue_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
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
        try { await xano.recordEventLog('capacity_check_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
      } catch (err) {
        xano.logLocal('capacity_check_emit_failed', { error: err.message });
      }
    }
  }

  // TECH_LATE_CHECK — fires once per day at 10:15am CT (10:15-12 grace).
  // For each tech whose first job today started at/before 10am CT but
  // who hasn't tapped Start Job, SMS them + Teddy.
  if (hour >= 10 && hour < 12) {
    let lateFired;
    try {
      lateFired = await xano.getTechLateCheckFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('tech_late_check_dedup_failed', { error: err.message });
      lateFired = null;
    }
    if (lateFired && !lateFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'TECH_LATE_CHECK',
          signal_strength: 65,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        try { await xano.recordEventLog('tech_late_check_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
      } catch (err) {
        xano.logLocal('tech_late_check_emit_failed', { error: err.message });
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
        try { await xano.recordEventLog('resume_nudge_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
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
        try { await xano.recordEventLog('unpaid_self_pay_digest_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
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
        try { await xano.recordEventLog('tdr_reminder_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
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
        try { await xano.recordEventLog('parts_arrival_check_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
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
        try { await xano.recordEventLog('schedule_gap_check_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
      } catch (err) {
        xano.logLocal('schedule_gap_check_emit_failed', { error: err.message });
      }
    }
  }

  // MONTHLY_TECH_WINNER — 1st of month, 9am CT.
  try {
    const dayCT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', day: 'numeric' }).format(new Date(nowTs));
    if (dayCT === '1' && hour >= 9 && hour < 12) {
      const dedupKey = `monthly_tech_winner_emitted_${new Date(nowTs).toISOString().slice(0, 7)}`;
      let prior;
      try { prior = await xano.getEventLogByAction(dedupKey); } catch (e) { prior = null; }
      if (!prior || !prior.exists) {
        try {
          await xano.emitSignal({ signal_type: 'MONTHLY_TECH_WINNER', signal_strength: 40, payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) } });
          await xano.recordEventLog(dedupKey, { since_ts_ms: sinceMs });
        } catch (err) { xano.logLocal('monthly_tech_winner_emit_failed', { error: err.message }); }
      }
    }
  } catch (err) { xano.logLocal('monthly_tech_winner_check_failed', { error: err.message }); }

  // GHOST_INTAKE_SWEEP — Sun 5am CT. Auto-cancels stale not_ready jobs
  // (>14d, no customer engagement). Caps at 20/run.
  try {
    const dayCT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (dayCT === 'Sun' && hour >= 5 && hour < 8) {
      const dedupKey = `ghost_intake_sweep_emitted_${new Date(nowTs).toISOString().slice(0, 10)}`;
      let prior;
      try { prior = await xano.getEventLogByAction(dedupKey); } catch (e) { prior = null; }
      if (!prior || !prior.exists) {
        try {
          await xano.emitSignal({ signal_type: 'GHOST_INTAKE_SWEEP', signal_strength: 35, payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) } });
          await xano.recordEventLog(dedupKey, { since_ts_ms: sinceMs });
        } catch (err) { xano.logLocal('ghost_intake_sweep_emit_failed', { error: err.message }); }
      }
    }
  } catch (err) { xano.logLocal('ghost_intake_sweep_check_failed', { error: err.message }); }

  // REACTIVATION_CAMPAIGN — Monday 11am CT (11-13 grace). Pulls dormant
  // customer candidates (>2y since first contact + no job in 6mo) and
  // SMSes up to 10/week with a re-engagement message.
  try {
    const dayMon = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (dayMon === 'Mon' && hour >= 11 && hour < 13) {
      const dedupKey = `reactivation_campaign_emitted_${new Date(nowTs).toISOString().slice(0, 10)}`;
      let prior;
      try { prior = await xano.getEventLogByAction(dedupKey); } catch (e) { prior = null; }
      if (!prior || !prior.exists) {
        try {
          await xano.emitSignal({
            signal_type: 'REACTIVATION_CAMPAIGN',
            signal_strength: 30,
            payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
          });
          await xano.recordEventLog(dedupKey, { since_ts_ms: sinceMs });
        } catch (err) {
          xano.logLocal('reactivation_campaign_emit_failed', { error: err.message });
        }
      }
    }
  } catch (err) {
    xano.logLocal('reactivation_campaign_check_failed', { error: err.message });
  }

  // TECH_WEEKLY_RECAP — fires once per week on Sundays 6-8pm CT.
  // Per-tech end-of-week SMS with stats + invitation to text any
  // preference change for next week (Phase 2c of SMS-first ant scheduler).
  // Dedup via tech_weekly_recap_sent event_log row keyed on (tech, week).
  try {
    const recapDow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(nowTs));
    if (recapDow === 'Sun' && hour >= 18 && hour < 20) {
      // Use this Sunday's CT midnight as the week_start_ms (matches the
      // weekly performance emit pattern). The agent dedups per tech, so
      // even if the tick fires multiple times in the 6-8pm window the
      // recap goes out at most once per tech.
      await xano.emitSignal({
        signal_type: 'TECH_WEEKLY_RECAP',
        signal_strength: 60,
        payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
      });
      try { await xano.recordEventLog('tech_weekly_recap_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
    }
  } catch (err) {
    xano.logLocal('tech_weekly_recap_emit_failed', { error: err.message });
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
          try { await xano.recordEventLog('weekly_performance_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
        } catch (err) {
          xano.logLocal('weekly_performance_emit_failed', { error: err.message });
        }
      }
    }
  } catch (err) {
    xano.logLocal('weekly_performance_dow_check_failed', { error: err.message });
  }

  // OFFICE_MORNING_BRIEFING — fires once per day at 8am CT (8-11 grace).
  // Sends Danielle + Teddy a summary of the day's todo counts.
  if (hour >= 8 && hour < 11) {
    let omFired;
    try {
      omFired = await xano.getOfficeMorningBriefingFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('office_morning_briefing_dedup_failed', { error: err.message });
      omFired = null;
    }
    if (omFired && !omFired.fired) {
      try {
        // Write the dedup marker FIRST. If this fails we throw and the
        // emit doesn't happen — next tick will retry the full pair.
        // Previously the marker write was inside a swallow-all
        // try/catch, so a silent write failure would let the next tick
        // re-emit and Danielle would get a duplicate SMS.
        await xano.recordEventLog('office_morning_briefing_emitted', { since_ts_ms: sinceMs });
        await xano.emitSignal({
          signal_type: 'OFFICE_MORNING_BRIEFING',
          signal_strength: 50,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
      } catch (err) {
        xano.logLocal('office_morning_briefing_emit_failed', { error: err.message });
      }
    }
  }

  // OFFICE_EOD_SUMMARY — fires once per day at 8pm CT (20-22 grace). EOD
  // digest to Teddy + Danielle summarizing today's activity.
  if (hour >= 20 && hour < 22) {
    let eodFired;
    try {
      eodFired = await xano.getOfficeEodSummaryFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('office_eod_summary_dedup_failed', { error: err.message });
      eodFired = null;
    }
    if (eodFired && !eodFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'OFFICE_EOD_SUMMARY',
          signal_strength: 50,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        try { await xano.recordEventLog('office_eod_summary_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
      } catch (err) {
        xano.logLocal('office_eod_summary_emit_failed', { error: err.message });
      }
    }
  }

  // TDR_COMPLETENESS_REPORT — fires once per day at 6:30pm CT (18:30-21 grace).
  // Right after daily_revenue_summary at 6pm. Sends Teddy the EOD digest of
  // techs with open TDRs from today.
  if (hour >= 18 && hour < 21) {
    let tcrFired;
    try {
      tcrFired = await xano.getTdrCompletenessReportFiredToday(sinceMs);
    } catch (err) {
      xano.logLocal('tdr_completeness_report_dedup_failed', { error: err.message });
      tcrFired = null;
    }
    if (tcrFired && !tcrFired.fired) {
      try {
        await xano.emitSignal({
          signal_type: 'TDR_COMPLETENESS_REPORT',
          signal_strength: 50,
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs) },
        });
        try { await xano.recordEventLog('tdr_completeness_report_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}
      } catch (err) {
        xano.logLocal('tdr_completeness_report_emit_failed', { error: err.message });
      }
    }
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
  try { await xano.recordEventLog('daily_briefing_emitted', { since_ts_ms: sinceMs }); } catch (_e) {}

  // TECH_ASSIST_LOOP_WATCH — every 5 min during 7am-10pm CT. Detects
  // interrogation loops in the new SMS Tech Assist flow + auto-pauses
  // techs hitting 2+ loops/day. Fired by tick.js (not by tick scheduler)
  // since the loop runs every 60s; this gate fires only every 5 min.
  if (hour >= 7 && hour < 22) {
    // Modulo-5 check on minute
    const minuteCT = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', minute: 'numeric' }).format(new Date(nowTs)), 10);
    if (Number.isFinite(minuteCT) && (minuteCT % 5) === 0) {
      try {
        await xano.emitSignal({
          signal_type: 'TECH_ASSIST_LOOP_WATCH',
          signal_strength: 60,
          payload: { now_ms: nowTs },
        });
      } catch (err) {
        xano.logLocal('tech_assist_loop_watch_emit_failed', { error: err.message });
      }
    }
  }

  // MARKETING_SITE_WATCH — every 5 min, 24/7. Probes tnapplianceexchange.net
  // root + key customer surfaces. Built after the 2026-05-30 incident where
  // a CSS regression hid the marketing site for 5 days under a stuck
  // "Loading your repair info" overlay. SMSes Teddy on first failure of
  // any surface; sends a one-line recovery SMS when a previously-failing
  // surface comes back. Dedup via event_log.
  {
    const minuteCTm = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', minute: 'numeric' }).format(new Date(nowTs)), 10);
    if (Number.isFinite(minuteCTm) && (minuteCTm % 5) === 0) {
      try {
        await xano.emitSignal({
          signal_type: 'MARKETING_SITE_WATCH',
          signal_strength: 70,
          payload: { now_ms: nowTs },
        });
      } catch (err) {
        xano.logLocal('marketing_site_watch_emit_failed', { error: err.message });
      }
    }
  }

  // COLONY_LOOP_SELF_WATCH — every 10 min, 24/7. Confirms loop is not
  // just alive but actually processing signals (counts event_log rows
  // in last 10 min). Catches "alive but stuck" — deadlocks, hung
  // agents, lost Xano connection.
  {
    const minuteCTs = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', minute: 'numeric' }).format(new Date(nowTs)), 10);
    if (Number.isFinite(minuteCTs) && (minuteCTs % 10) === 0) {
      try {
        await xano.emitSignal({
          signal_type: 'COLONY_LOOP_SELF_WATCH',
          signal_strength: 80,
          payload: { now_ms: nowTs },
        });
      } catch (err) {
        xano.logLocal('colony_loop_self_watch_emit_failed', { error: err.message });
      }
    }
  }

  // XANO_API_WATCH — every 15 min, 24/7. Probes a cheap Xano endpoint
  // with a 5-sec timeout. Alerts on two consecutive failures so a
  // single flaky tick does not false-alarm.
  {
    const minuteCTx = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', minute: 'numeric' }).format(new Date(nowTs)), 10);
    if (Number.isFinite(minuteCTx) && (minuteCTx % 15) === 0) {
      try {
        await xano.emitSignal({
          signal_type: 'XANO_API_WATCH',
          signal_strength: 90,
          payload: { now_ms: nowTs },
        });
      } catch (err) {
        xano.logLocal('xano_api_watch_emit_failed', { error: err.message });
      }
    }
  }

  // PARALLEL_INTAKE_WATCH — every hour during business hours (8am-9pm
  // CT). Looks for parallel_job_created_from_email rows in the last 2
  // hours. If zero, AHS/SP pollers may be stuck.
  if (hour >= 8 && hour < 21) {
    const minuteCTp = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', minute: 'numeric' }).format(new Date(nowTs)), 10);
    if (Number.isFinite(minuteCTp) && minuteCTp === 0) {
      try {
        await xano.emitSignal({
          signal_type: 'PARALLEL_INTAKE_WATCH',
          signal_strength: 75,
          payload: { now_ms: nowTs },
        });
      } catch (err) {
        xano.logLocal('parallel_intake_watch_emit_failed', { error: err.message });
      }
    }
  }

  // ASSIGN_PARALLEL_TEST_JOBS — REMOVED per revised brief. Phase 1 has
  // NO auto-assignment. Danielle manually schedules every parallel job
  // through needs-scheduled.html. Agent file kept dormant in case Phase 2
  // revives auto-assignment.

  // TECH_ASSIST_EOD_REPORT — Teddy at 6pm CT (18:00-18:30 grace window)
  if (hour === 18) {
    try {
      const eodFired = await xano.getEventLogByAction('tech_assist_eod_handled');
      const items = (eodFired && eodFired.items) || [];
      const todayStartMs = nowTs - (12 * 3600 * 1000);
      const firedToday = items.some(r => Number(r.created_at) > todayStartMs);
      if (!firedToday) {
        await xano.emitSignal({
          signal_type: 'TECH_ASSIST_EOD_REPORT',
          signal_strength: 70,
          payload: { now_ms: nowTs },
        });
        await xano.recordEventLog('tech_assist_eod_emitted', { now_ms: nowTs });
      }
    } catch (err) {
      xano.logLocal('tech_assist_eod_emit_failed', { error: err.message });
    }
  }
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
