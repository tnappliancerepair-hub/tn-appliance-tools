// SPEND ANOMALY DETECTOR
//
// Daily 11pm CT — compares today's Claude spend (from claude_call_log)
// against trailing 7-day baseline. Alerts Teddy when today's spend
// exceeds:
//   - 2x baseline AND > $20 (catches early ramp before hitting cap)
//   - 5x baseline (catches runaway)
//   - approaches ANT_DAILY_HARD_CAP_USD * 0.8 (catches imminent block)
//
// Also surfaces top 3 (brain, signal_type) cells by today's spend so
// Teddy knows WHERE the spend is going, not just THAT it spiked.
//
// Cost safety: spend cap (#3 from intelligence systems) is a hard
// floor; this is the SOFT signal that gets surfaced before we hit
// the hard cap.

import { listRecentEventLog } from '../xano.js';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  // Pull today's + last-7d aggregate spend from claude_call_log via
  // dedicated lookup endpoint.
  let summary;
  try {
    const r = await fetch(`${XANO_BASE}/get_claude_spend_summary?include_breakdown=true`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) summary = await r.json();
  } catch (e) {
    log('spend_anomaly_query_failed', { error: String(e) });
  }

  if (!summary || !summary.success) {
    await xano.markSignalProcessed(signal.id, 'spend_anomaly_handled', { reason: 'no_summary' });
    return { success: false, action: 'no_summary' };
  }

  const todayUsd     = Number(summary.today_usd || 0);
  const baseline7Avg = Number(summary.baseline_7d_avg_usd || 0);
  const breakdown    = summary.top_cells_today || [];

  const softCap = Number(process.env.ANT_DAILY_SPEND_CAP_USD || 50);
  const hardCap = Number(process.env.ANT_DAILY_HARD_CAP_USD || softCap * 4);

  const triggers = [];
  if (baseline7Avg > 1 && todayUsd >= baseline7Avg * 5) {
    triggers.push(`5x baseline ($${todayUsd.toFixed(2)} vs $${baseline7Avg.toFixed(2)} avg)`);
  } else if (baseline7Avg > 1 && todayUsd >= baseline7Avg * 2 && todayUsd >= 20) {
    triggers.push(`2x baseline ($${todayUsd.toFixed(2)} vs $${baseline7Avg.toFixed(2)} avg)`);
  }
  if (todayUsd >= hardCap * 0.8) {
    triggers.push(`approaching hard cap ($${todayUsd.toFixed(2)} / $${hardCap.toFixed(2)})`);
  }

  if (triggers.length === 0) {
    await xano.markSignalProcessed(signal.id, 'spend_anomaly_handled', { spike: false, today_usd: todayUsd, baseline_avg: baseline7Avg });
    log('spend_anomaly_clean', { today: todayUsd, baseline: baseline7Avg });
    return { success: true, action: 'no_anomaly' };
  }

  const lines = [`[ant] ⚠ Claude spend anomaly today:`, ''];
  for (const t of triggers) lines.push(`  • ${t}`);
  if (breakdown.length > 0) {
    lines.push('');
    lines.push('Top spend cells today:');
    for (const cell of breakdown.slice(0, 3)) {
      lines.push(`  ${cell.brain || '?'}·${(cell.signal_type || '?').toLowerCase()} — $${Number(cell.usd || 0).toFixed(2)} (${cell.calls || 0} calls)`);
    }
  }
  lines.push('');
  lines.push(`Soft cap: $${softCap}. Hard cap: $${hardCap}. ANT_AUTONOMY_DISABLED=true to brake.`);

  let smsResult;
  try { smsResult = await sms.toOwner(lines.join('\n'), { call_site: 'spend_anomaly_detector' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  await xano.markSignalProcessed(signal.id, 'spend_anomaly_handled', {
    spike: true, today_usd: todayUsd, baseline_avg: baseline7Avg,
    triggers, sms_ok: !!(smsResult && smsResult.ok),
  });
  log('spend_anomaly_alerted', { today_usd: todayUsd, triggers_count: triggers.length });
  return { success: true, action: 'alerted', triggers: triggers.length };
}
