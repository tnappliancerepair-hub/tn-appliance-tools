// APPOINTMENT NO-SHOW PREDICTOR
//
// Fires daily 6pm CT — for every job scheduled tomorrow, computes a
// no-show risk score from:
//   - prior no-show history on this customer (each +30)
//   - prior cancellations on this customer (each +10)
//   - customer has no portal_viewed event in past 90d (+15)
//   - customer has no inbound SMS reply in past 90d (+15)
//   - new customer (created < 14d ago, first appt) (+10)
//   - no waiver signed yet by appt date (+20)
//
// Scores ≥40 = high-risk → SMS Teddy "consider proactive confirmation
// call". Optionally auto-fires phone-ant-outbound with purpose=
// appointment_reminder for ≥60 score.
//
// Reduces wasted truck rolls. Even 1 prevented no-show/week saves
// $80-150 in tech-hours + parts.

import { recordEvent } from '../xano.js';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  // Pull tomorrow's scheduled jobs
  let jobs = [];
  try {
    const r = await fetch(`${XANO_BASE}/list_tomorrow_scheduled_jobs`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const data = await r.json();
      jobs = (data && data.items) || [];
    }
  } catch (e) { log('no_show_predictor_query_failed', { error: String(e) }); }

  if (jobs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'no_show_predictor_handled', { jobs: 0 });
    return { success: true, action: 'no_jobs' };
  }

  const highRisk = [];
  for (const job of jobs) {
    let score = 0;
    const reasons = [];

    // History: get customer's prior no-shows + cancels
    let history;
    try {
      const r = await fetch(`${XANO_BASE}/get_customer_no_show_history?customer_id=${job.customer_id}`, { signal: AbortSignal.timeout(6000) });
      if (r.ok) history = await r.json();
    } catch (_) {}

    if (history) {
      const noShows = Number(history.no_shows || 0);
      const cancels = Number(history.cancellations || 0);
      if (noShows > 0) { score += noShows * 30; reasons.push(`${noShows} prior no-show${noShows > 1 ? 's' : ''}`); }
      if (cancels > 0) { score += cancels * 10; reasons.push(`${cancels} prior cancel${cancels > 1 ? 's' : ''}`); }
      if (history.portal_views_90d === 0) { score += 15; reasons.push('no portal views 90d'); }
      if (history.sms_replies_90d === 0) { score += 15; reasons.push('no SMS replies 90d'); }
      if (history.customer_age_days < 14 && history.is_first_appt) { score += 10; reasons.push('new customer, 1st appt'); }
    }
    if (!job.waiver_signed) { score += 20; reasons.push('no waiver yet'); }

    if (score >= 40) {
      highRisk.push({
        job_id: job.id,
        customer_name: job.customer_name,
        scheduled_start_ct: job.scheduled_start_ct,
        tech_first_name: job.tech_first_name,
        score,
        reasons,
      });
    }
  }

  if (highRisk.length === 0) {
    await xano.markSignalProcessed(signal.id, 'no_show_predictor_handled', { jobs: jobs.length, high_risk: 0 });
    log('no_show_predictor_clean', { jobs: jobs.length });
    return { success: true, action: 'no_high_risk' };
  }

  highRisk.sort((a, b) => b.score - a.score);

  const lines = [`[ant] tomorrow's no-show risk — ${highRisk.length} high-risk:`];
  for (const r of highRisk.slice(0, 10)) {
    lines.push('');
    lines.push(`#${r.job_id} ${r.customer_name} @${r.scheduled_start_ct} (${r.tech_first_name || 'unassigned'}) — score ${r.score}`);
    lines.push(`  reasons: ${r.reasons.join('; ')}`);
  }
  lines.push('');
  lines.push('Consider proactive confirmation call for top ones.');

  let smsResult;
  try { smsResult = await sms.toOwner(lines.join('\n'), { call_site: 'appointment_no_show_predictor' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  for (const r of highRisk) {
    try {
      await recordEvent('no_show_risk_flagged', {
        job_id: r.job_id, score: r.score, reasons: r.reasons, flagged_at_ms: Date.now(),
      });
    } catch (_) {}
  }

  await xano.markSignalProcessed(signal.id, 'no_show_predictor_handled', {
    jobs: jobs.length, high_risk: highRisk.length, sms_ok: !!(smsResult && smsResult.ok),
  });
  log('no_show_predictor_alerted', { count: highRisk.length });
  return { success: true, action: 'alerted', count: highRisk.length };
}
