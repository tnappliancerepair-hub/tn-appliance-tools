// Signal in: TECH_COMPARISON_REPORT
// Fires weekly (Mon 10-11am CT). Reads per-tech aggregates for the last
// 30 days, ranks by composite score (volume + ticket size + TDR
// completeness), and SMSes Teddy a leaderboard + outlier highlights.
//
// Goal: knowledge extraction. If Andre's first-visit-fix is 95% and
// Jimmy's is 70%, the report makes that gap visible so Teddy can dig
// into what Andre is doing differently.

import { config } from '../config.js';

const INTAKE = (path) => `${config.xanoIntakeBase}${path}`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let summary;
  try {
    const r = await fetch(INTAKE('/get_tech_comparison_summary?days_back=30'));
    summary = await r.json();
  } catch (err) {
    const meta = { outcome: 'fetch_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'tech_comparison_handled', meta);
    log('tech_comparison_fetch_failed', meta);
    return { success: false, action: 'fetch_failed' };
  }

  const techs = (summary && summary.techs) || [];
  if (techs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'tech_comparison_handled', { outcome: 'no_techs' });
    return { success: true, action: 'no_techs' };
  }

  const enriched = techs.map((t) => ({
    ...t,
    name: ((t.first_name || '') + ' ' + (t.last_name || '')).trim() || `tech ${t.tech_id}`,
    tdr_completeness_pct: t.tdrs_written > 0 ? (t.tdrs_complete / t.tdrs_written) : 0,
  }));

  // Ranks
  const byJobs    = [...enriched].sort((a, b) => b.jobs_completed - a.jobs_completed);
  const byTicket  = [...enriched].sort((a, b) => b.avg_ticket_cents - a.avg_ticket_cents);
  const byTdrPct  = [...enriched].sort((a, b) => b.tdr_completeness_pct - a.tdr_completeness_pct);

  const fmtMoney = (c) => '$' + Math.round(c / 100);
  const fmtPct = (p) => Math.round(p * 100) + '%';

  // Outlier detection — large gaps between top + bottom
  let outliers = [];
  if (byJobs.length >= 2) {
    const top = byJobs[0], bot = byJobs[byJobs.length - 1];
    if (top.jobs_completed > bot.jobs_completed * 2 && bot.jobs_completed > 0) {
      outliers.push(`Volume gap: ${top.first_name}=${top.jobs_completed} vs ${bot.first_name}=${bot.jobs_completed}`);
    }
  }
  if (byTdrPct.length >= 2) {
    const top = byTdrPct[0], bot = byTdrPct[byTdrPct.length - 1];
    if ((top.tdr_completeness_pct - bot.tdr_completeness_pct) > 0.3) {
      outliers.push(`TDR completeness gap: ${top.first_name}=${fmtPct(top.tdr_completeness_pct)} vs ${bot.first_name}=${fmtPct(bot.tdr_completeness_pct)}`);
    }
  }

  // Top 3 by jobs for the SMS preview
  const top3 = byJobs.slice(0, 3).map((t) =>
    `${t.first_name}: ${t.jobs_completed}j / ${fmtMoney(t.revenue_cents)} / tdr ${fmtPct(t.tdr_completeness_pct)}`
  ).join('; ');

  const body = `[ant] tech compare (last 30d). Top: ${top3}.${outliers.length ? ' ⚠️ ' + outliers.join(' · ') : ''}`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'tech_comparison_digest',
        tech_count: enriched.length,
        outliers: outliers.length,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      smsResult = String(e.message || e);
    }
  }

  const meta = {
    outcome: 'digest_sent',
    tech_count: enriched.length,
    leaderboard: byJobs.map((t) => ({
      tech_id: t.tech_id,
      name: t.name,
      jobs: t.jobs_completed,
      revenue_cents: t.revenue_cents,
      avg_ticket_cents: t.avg_ticket_cents,
      tdr_pct: t.tdr_completeness_pct,
    })),
    outliers,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'tech_comparison_handled', meta);
  log('tech_comparison_handled', meta);
  return { success: true, action: 'tech_comparison_handled' };
}
