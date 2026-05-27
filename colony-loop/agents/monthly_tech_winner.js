// Handles MONTHLY_TECH_WINNER signals (emitted by tick.js on the 1st
// of each month at 9am CT). Pulls last month's leaderboard, identifies
// the top tech, SMSes the team + Teddy.
import { config } from '../config.js';
import { toOwner, toTech, normalizeE164 } from '../sms.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let lb = null;
  try {
    const res = await fetch(`${config.xanoIntakeBase}/get_tech_leaderboard?month_offset=-1`);
    lb = await res.json();
  } catch (err) {
    log('monthly_tech_winner_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'monthly_tech_winner_handled', { outcome: 'load_failed' });
    return { success: false, action: 'load_failed' };
  }

  const rows = (lb && lb.leaderboard) || [];
  if (rows.length === 0) {
    await xano.markSignalProcessed(signal.id, 'monthly_tech_winner_handled', { outcome: 'no_data' });
    return { success: true, action: 'no_data' };
  }

  rows.sort((a, b) => (b.jobs_completed - a.jobs_completed) || (b.earnings_total - a.earnings_total));
  const winner = rows[0];

  if (winner.jobs_completed === 0) {
    await xano.markSignalProcessed(signal.id, 'monthly_tech_winner_handled', { outcome: 'no_completed_jobs' });
    return { success: true, action: 'no_completed_jobs' };
  }

  const monthLabel = lb.month_label || 'last month';
  const winnerName = `${winner.first_name || ''} ${winner.last_name || ''}`.trim() || `tech #${winner.tech_id}`;

  // Owner SMS — full standings
  const ownerLines = rows.slice(0, 6).map((r, i) => {
    const medal = ['🥇','🥈','🥉','4.','5.','6.'][i] || `${i+1}.`;
    const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || `t${r.tech_id}`;
    return `${medal} ${name}: ${r.jobs_completed} jobs`;
  });
  const ownerBody = `[ant] 🏆 ${monthLabel} Tech of the Month: ${winnerName} (${winner.jobs_completed} jobs).\n` + ownerLines.join('\n');

  try { await toOwner(ownerBody, { action: 'monthly_tech_winner_sent', source_signal_id: signal.id }); }
  catch (e) { /* */ }

  // Winning tech SMS — congratulations
  const techPhone = normalizeE164(winner.phone);
  if (techPhone) {
    const techBody =
      `[ant] 🏆 ${winner.first_name || 'you'} - you're Tech of the Month for ${monthLabel}! ` +
      `${winner.jobs_completed} jobs completed. Bonus details from Teddy soon. Long Live Ant.`;
    try {
      await toTech(techPhone, techBody, {
        action: 'monthly_tech_winner_tech_sms',
        tech_id: winner.tech_id,
        source_signal_id: signal.id,
      });
    } catch (e) { /* */ }
  }

  const meta = {
    winner_tech_id: winner.tech_id,
    winner_name: winnerName,
    jobs_completed: winner.jobs_completed,
    month: monthLabel,
    outcome: 'winner_announced',
  };
  await xano.markSignalProcessed(signal.id, 'monthly_tech_winner_handled', meta);
  log('monthly_tech_winner_handled', meta);
  return { success: true, action: 'winner_announced', ...meta };
}
