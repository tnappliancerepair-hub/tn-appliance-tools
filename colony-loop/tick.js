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
  if (hour < 8 || hour >= 11) return;

  const sinceMs = ctMidnightMs(nowTs);
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
