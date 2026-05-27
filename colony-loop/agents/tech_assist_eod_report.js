// Step 11 — Tech Assist End-of-Day Report
//
// Fires at 6pm CT via tick.js. Reports today's Tech Assist usage:
// sessions started, TDRs saved cleanly, loops triggered, manual pauses.
// Per-tech breakdown to Teddy.
import { toOwner } from '../sms.js';

const ACTIVE_TECH_IDS = [2, 3, 4, 5, 6];
const TECH_NAMES = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  const lines = [`[ant] Tech Assist EOD ${fmtDate(new Date())}`];

  let totals = { sessions: 0, saved: 0, loops: 0, paused: 0 };

  for (const techId of ACTIVE_TECH_IDS) {
    let stats;
    try {
      stats = await xano.getTechAssistEodStats(techId);
    } catch (err) {
      log('tech_assist_eod_lookup_failed', { tech_id: techId, error: String(err.message || err) });
      continue;
    }
    const s = stats || {};
    const sessions = Number(s.sessions) || 0;
    const saved = Number(s.saved) || 0;
    const loops = Number(s.loops) || 0;
    const paused = Boolean(s.is_paused);
    const name = TECH_NAMES[techId] || `tech_${techId}`;

    totals.sessions += sessions;
    totals.saved += saved;
    totals.loops += loops;
    totals.paused += paused ? 1 : 0;

    if (sessions === 0 && !paused) continue;
    lines.push(`${name}: ${sessions} sess, ${saved} saved, ${loops} loop${loops === 1 ? '' : 's'}${paused ? ' [PAUSED]' : ''}`);
  }

  lines.push(``);
  lines.push(`Total: ${totals.sessions} sess, ${totals.saved} saved, ${totals.loops} loops, ${totals.paused} paused`);

  // Parallel-mode metrics — count today's parallel_test_assigned vs
  // parallel_test_completed (tdr saved on that job by that tech)
  try {
    const assigns = await xano.getEventLogByAction('parallel_test_assigned');
    const dayStart = Date.now() - 16 * 3600 * 1000;
    const todayAssigns = ((assigns && assigns.items) || []).filter(r => Number(r.created_at) > dayStart);
    const droppedCust = await xano.getEventLogByAction('dropped_customer_sms');
    const todayDropped = ((droppedCust && droppedCust.items) || []).filter(r => Number(r.created_at) > dayStart);
    lines.push(``);
    lines.push(`Parallel tests assigned: ${todayAssigns.length}`);
    lines.push(`Dropped customer SMSes (gate caught): ${todayDropped.length}`);
  } catch (err) {
    lines.push(`Parallel/gate metrics: lookup failed (${String(err.message || err).slice(0, 40)})`);
  }

  const body = lines.join('\n');
  try {
    await toOwner(body, { action: 'tech_assist_eod_report', ...totals });
  } catch (err) {
    log('tech_assist_eod_send_failed', { error: String(err.message || err) });
  }

  const meta = { outcome: 'eod_sent', ...totals };
  await xano.markSignalProcessed(signal.id, 'tech_assist_eod_handled', meta);
  log('tech_assist_eod_handled', meta);

  return { success: true, action: 'eod_sent', ...totals };
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
}
