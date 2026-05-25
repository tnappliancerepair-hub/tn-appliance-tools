import { config } from './config.js';
import * as xano from './xano.js';
import { dispatch } from './dispatch.js';
import { ctMidnightMs, ctHour, fmtCT } from './time.js';
import * as sms from './sms.js';
import * as claude from './claude.js';
import { escalate } from './escalate.js';

let running = false;
let lastHeartbeat = 0;
const HEARTBEAT_MS = 15 * 60 * 1000;

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
          payload: { since_ts_ms: sinceMs, emitted_ct: fmtCT(nowTs), max_builds: 1 },
        });
        xano.logLocal('colony_architect_emitted', { since_ts_ms: sinceMs });
      } catch (err) {
        xano.logLocal('colony_architect_emit_failed', { error: err.message });
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
