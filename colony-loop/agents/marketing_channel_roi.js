// Signal in: MARKETING_CHANNEL_ROI
// Fires weekly (Mon 9-10am CT). Reads last 30 days of jobs grouped by
// intake_source, computes revenue + avg-per-job + completion rate, and
// SMSes Teddy a per-channel breakdown so he knows which sources are
// profitable vs which are noise.
//
// Pure aggregation (no Claude) — just math over jobs.total_amount_cents.

import { config } from '../config.js';

const INTAKE = (path) => `${config.xanoIntakeBase}${path}`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let summary;
  try {
    const r = await fetch(INTAKE('/get_channel_roi_summary?days_back=30'));
    summary = await r.json();
  } catch (err) {
    const meta = { outcome: 'fetch_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'marketing_channel_roi_handled', meta);
    log('marketing_channel_roi_fetch_failed', meta);
    return { success: false, action: 'fetch_failed' };
  }

  const rows = (summary && summary.rows) || [];
  const totalJobs = Number(summary?.total_jobs || 0);

  if (rows.length === 0) {
    const meta = { outcome: 'no_jobs', total_jobs: 0, note: 'no jobs with total_amount_cents > 0 in last 30d' };
    await xano.markSignalProcessed(signal.id, 'marketing_channel_roi_handled', meta);
    log('marketing_channel_roi_no_data', meta);
    return { success: true, action: 'no_jobs' };
  }

  // Group by intake_source. Handle missing values gracefully — bucket
  // anything blank/unknown as 'unknown' so the digest doesn't lose data.
  const byChannel = {};
  for (const j of rows) {
    const src = (j.intake_source || j.source_type || 'unknown').toLowerCase();
    if (!byChannel[src]) byChannel[src] = { jobs: 0, revenue_cents: 0, completed: 0, canceled: 0 };
    byChannel[src].jobs += 1;
    byChannel[src].revenue_cents += Number(j.total_amount_cents || 0);
    const status = (j.scheduling_status || j.current_status || '').toLowerCase();
    if (status === 'completed') byChannel[src].completed += 1;
    if (status === 'canceled' || status === 'cancelled') byChannel[src].canceled += 1;
  }

  const ranked = Object.entries(byChannel).map(([src, m]) => ({
    channel: src,
    jobs: m.jobs,
    revenue_cents: m.revenue_cents,
    avg_per_job_cents: Math.round(m.revenue_cents / Math.max(m.jobs, 1)),
    completion_rate: m.completed / Math.max(m.jobs, 1),
    cancel_rate: m.canceled / Math.max(m.jobs, 1),
  })).sort((a, b) => b.revenue_cents - a.revenue_cents);

  const fmtMoney = (c) => '$' + (c / 100).toFixed(0);
  const fmtPct = (p) => Math.round(p * 100) + '%';

  const top = ranked.slice(0, 4).map((r) =>
    `${r.channel}: ${r.jobs}j ${fmtMoney(r.revenue_cents)} (avg ${fmtMoney(r.avg_per_job_cents)}, complete ${fmtPct(r.completion_rate)})`
  ).join('; ');

  // Identify a problem channel: high volume but low avg revenue OR high cancel rate
  let problem = '';
  for (const r of ranked) {
    if (r.jobs >= 5 && r.avg_per_job_cents < 10000) { problem = `Low avg ticket: ${r.channel} ${fmtMoney(r.avg_per_job_cents)}/job`; break; }
    if (r.jobs >= 5 && r.cancel_rate > 0.25)       { problem = `High cancel: ${r.channel} ${fmtPct(r.cancel_rate)}`; break; }
  }

  const body = `[ant] channel ROI (last 30d, ${totalJobs} jobs). Top: ${top}. ${problem ? '⚠️ ' + problem : ''}`.trim();

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'marketing_channel_roi_digest',
        total_jobs: totalJobs,
        channel_count: ranked.length,
        top_channel: ranked[0]?.channel,
        top_revenue_cents: ranked[0]?.revenue_cents || 0,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      smsResult = String(e.message || e);
    }
  }

  const meta = {
    outcome: 'digest_sent',
    total_jobs: totalJobs,
    ranked,
    problem_flagged: problem || null,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'marketing_channel_roi_handled', meta);
  log('marketing_channel_roi_handled', meta);
  return { success: true, action: 'marketing_channel_roi_handled', channels: ranked.length };
}
