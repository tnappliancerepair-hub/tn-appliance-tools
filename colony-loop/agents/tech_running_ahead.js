// Signal in: TECH_RUNNING_AHEAD (from tech_pace_watcher)
// V1 observer mode: load tech context + flag potential insertion
// candidates, SMS Teddy with the proposal. Customer-facing outreach
// is deferred to v2 once Teddy validates the signal patterns.
//
// Future: bidirectional approval (tech YES → customer SMS).

import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const p = signal.payload || {};
  const techId = p.tech_id;
  const techName = p.tech_name || ('tech ' + techId);
  const minutesAhead = p.minutes_ahead || 0;

  if (!techId) {
    await xano.markSignalProcessed(signal.id, 'tech_ahead_handled', { outcome: 'no_tech_id' });
    return { success: false, action: 'no_tech_id' };
  }

  // Dedup — only one ahead-offer per tech per hour
  const dedupKey = `tech_ahead_offered_${techId}`;
  let recent;
  try {
    recent = await xano.findRecentEventLog
      ? await xano.findRecentEventLog(dedupKey, Date.now() - 60 * 60 * 1000)
      : null;
  } catch (_) { recent = null; }
  if (recent && recent.found) {
    await xano.markSignalProcessed(signal.id, 'tech_ahead_handled', { outcome: 'recent_offer_skipped' });
    return { success: true, action: 'recent_offer_skipped' };
  }

  // SMS Teddy the observation
  const body =
    `[ant] ${techName} running ${minutesAhead}min ahead. ` +
    `Completed ${p.completed}/${p.total_today}. ` +
    `v1 observer: would scan parts_arrived jobs in cluster + open-today customers for an insertion offer.`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, { action: 'tech_ahead_proposal', tech_id: techId, minutes_ahead: minutesAhead });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (err) {
      smsResult = String(err.message || err);
    }
  }

  const meta = {
    outcome: 'observed',
    tech_id: techId,
    tech_name: techName,
    minutes_ahead: minutesAhead,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'tech_ahead_handled', meta);
  // Audit-marker so dedup works next run
  try { await xano.recordEventLog(dedupKey, { tech_id: techId, minutes_ahead: minutesAhead }); } catch (_) {}
  log('tech_ahead_handled', meta);
  return { success: true, action: 'tech_ahead_handled' };
}
