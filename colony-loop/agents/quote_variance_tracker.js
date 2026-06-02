// Signal in: QUOTE_VARIANCE_REPORT
// Fires weekly (Mon 11am-12pm CT). Reads completed jobs from last 30
// days where BOTH quoted_amount_cents > 0 AND total_amount_cents > 0,
// computes per-tech + per-appliance variance, surfaces consistent
// under/overquoting patterns.
//
// SCAFFOLD STATE: jobs.quoted_amount_cents column was added today,
// but historical jobs do NOT have it populated. The agent will report
// 'insufficient_quote_data' until the intake flow + create_job_from_chat
// + book_appointment_from_office start writing the column. Sweep task:
// add quote capture to the 3 main intake endpoints.

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
    await xano.markSignalProcessed(signal.id, 'quote_variance_handled', meta);
    return { success: false, action: 'fetch_failed' };
  }

  const rows = (summary && summary.rows) || [];
  const withBoth = rows.filter((j) => Number(j.quoted_amount_cents || 0) > 0 && Number(j.total_amount_cents || 0) > 0);

  if (withBoth.length < 10) {
    const meta = {
      outcome: 'insufficient_quote_data',
      jobs_with_both: withBoth.length,
      total_jobs_30d: rows.length,
      note: 'quoted_amount_cents column is new — intake endpoints need to populate it before variance becomes meaningful',
    };
    await xano.markSignalProcessed(signal.id, 'quote_variance_handled', meta);
    log('quote_variance_insufficient_data', meta);
    return { success: true, action: 'insufficient_quote_data' };
  }

  // Per-tech, per-appliance variance
  const byTech = {};
  const byAppliance = {};
  let totalUnderquoted = 0;
  let totalOverquoted = 0;
  let totalVarianceCents = 0;
  for (const j of withBoth) {
    const variance = Number(j.total_amount_cents || 0) - Number(j.quoted_amount_cents || 0);
    totalVarianceCents += variance;
    if (variance > 0) totalUnderquoted += 1;
    if (variance < 0) totalOverquoted += 1;
    const tech = String(j.technician_id || 'unassigned');
    if (!byTech[tech]) byTech[tech] = { count: 0, variance: 0 };
    byTech[tech].count += 1;
    byTech[tech].variance += variance;
    const appl = (j.appliance_type || 'unknown').toLowerCase();
    if (!byAppliance[appl]) byAppliance[appl] = { count: 0, variance: 0 };
    byAppliance[appl].count += 1;
    byAppliance[appl].variance += variance;
  }

  const avgVariance = totalVarianceCents / withBoth.length;
  const fmtMoney = (c) => '$' + Math.round(c / 100);

  const worstTech = Object.entries(byTech)
    .map(([t, m]) => ({ tech_id: t, avg_variance: m.variance / m.count, count: m.count }))
    .filter((t) => t.count >= 3)
    .sort((a, b) => Math.abs(b.avg_variance) - Math.abs(a.avg_variance))[0];

  let body = `[ant] quote variance (last 30d, ${withBoth.length} jobs): avg ${fmtMoney(avgVariance)} `;
  body += avgVariance > 0 ? '(systematically UNDERquoting). ' : '(systematically OVERquoting). ';
  if (worstTech) {
    body += `Biggest gap: tech ${worstTech.tech_id} avg ${fmtMoney(worstTech.avg_variance)} on ${worstTech.count} jobs.`;
  }

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'quote_variance_digest',
        jobs_analyzed: withBoth.length,
        avg_variance_cents: avgVariance,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      smsResult = String(e.message || e);
    }
  }

  const meta = {
    outcome: 'digest_sent',
    jobs_analyzed: withBoth.length,
    avg_variance_cents: avgVariance,
    underquoted_count: totalUnderquoted,
    overquoted_count: totalOverquoted,
    worst_tech: worstTech,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'quote_variance_handled', meta);
  log('quote_variance_handled', meta);
  return { success: true, action: 'quote_variance_handled' };
}
