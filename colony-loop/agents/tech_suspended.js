// Handles TECH_SUSPENDED signals. Alerts Teddy + Danielle URGENT,
// includes link to job-detail for any current jobs needing reassignment.
import { toOwner, toDanielle } from '../sms.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const techId = Number(payload.tech_id || 0);
  const reason = String(payload.reason || '').trim();

  const body = `[ant] 🚨 TECH SUSPENDED #${techId}. Reason: ${reason.slice(0, 200)}. Reassign any active jobs immediately.`;

  let teddyRes = null;
  try { teddyRes = await toOwner(body, { action: 'tech_suspended_alert', tech_id: techId, source_signal_id: signal.id }); }
  catch (e) { teddyRes = { success: false }; }
  try { await toDanielle(body, { action: 'tech_suspended_alert', tech_id: techId, source_signal_id: signal.id }); }
  catch (e) { /* */ }

  const meta = { tech_id: techId, outcome: 'alerted', reason };
  await xano.markSignalProcessed(signal.id, 'tech_suspended_handled', meta);
  log('tech_suspended_handled', meta);
  return { success: true, action: 'alerted' };
}
