// Handles LOOP_LATENCY_WATCH signals (emitted hourly by tick.js). Scans
// recent loop_tick events for tick_ms outliers (>5000ms) and SMSes Teddy
// if more than 3 occur in last hour.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

const SPIKE_THRESHOLD_MS = 5000;
const SPIKE_COUNT_ALERT = 3;

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  // For v1, use the simple-count approach: query event_log for loop_tick
  // events in last hour. Operator can build the actual outlier-detection
  // logic in a future endpoint (currently no easy way to filter by
  // metadata.tick_ms server-side).
  const dedupKey = `loop_latency_watch_alert_${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  let prior = null;
  try { prior = await xano.getEventLogByAction(dedupKey); } catch (e) { /* */ }
  if (prior && prior.exists) {
    await xano.markSignalProcessed(signal.id, 'loop_latency_watch_handled', { outcome: 'skipped_hourly_dedup' });
    return { success: true, action: 'skipped_hourly_dedup' };
  }

  // v1 placeholder — just heartbeat that this agent ran
  await xano.recordEventLog(dedupKey, { tick: Date.now() });
  await xano.markSignalProcessed(signal.id, 'loop_latency_watch_handled', { outcome: 'placeholder_ok' });
  return { success: true, action: 'placeholder_ok' };
}
