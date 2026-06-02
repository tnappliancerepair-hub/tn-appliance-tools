// Signal in: TECH_RUNNING_BEHIND (from tech_pace_watcher)
// V1 observer mode: SMS Teddy with the behind situation so he can
// eyeball whether a flex-customer swap would help. Real swap automation
// graduates in v2 once Teddy confirms the pace heuristic + flex-score
// surfaces are reliable.

import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const p = signal.payload || {};
  const techId = p.tech_id;
  const techName = p.tech_name || ('tech ' + techId);
  const minutesBehind = p.minutes_behind || 0;

  if (!techId) {
    await xano.markSignalProcessed(signal.id, 'tech_behind_handled', { outcome: 'no_tech_id' });
    return { success: false, action: 'no_tech_id' };
  }

  // Dedup — only one behind-alert per tech per hour
  const dedupKey = `tech_behind_alerted_${techId}`;
  let recent;
  try {
    recent = await xano.findRecentEventLog
      ? await xano.findRecentEventLog(dedupKey, Date.now() - 60 * 60 * 1000)
      : null;
  } catch (_) { recent = null; }
  if (recent && recent.found) {
    await xano.markSignalProcessed(signal.id, 'tech_behind_handled', { outcome: 'recent_alert_skipped' });
    return { success: true, action: 'recent_alert_skipped' };
  }

  const body =
    `[ant] ${techName} running ${minutesBehind}min behind. ` +
    `Completed ${p.completed}/${p.total_today}, ${p.remaining} remaining. ` +
    `v1 observer: would scan today's remaining for flex-customer swap candidates.`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, { action: 'tech_behind_alert', tech_id: techId, minutes_behind: minutesBehind });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (err) {
      smsResult = String(err.message || err);
    }
  }

  const meta = {
    outcome: 'observed',
    tech_id: techId,
    tech_name: techName,
    minutes_behind: minutesBehind,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'tech_behind_handled', meta);
  try { await xano.recordEventLog(dedupKey, { tech_id: techId, minutes_behind: minutesBehind }); } catch (_) {}
  log('tech_behind_handled', meta);
  return { success: true, action: 'tech_behind_handled' };
}
