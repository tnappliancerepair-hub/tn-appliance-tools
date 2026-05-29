// TECH PERFORMANCE ALERT
//
// Weekly Sunday 11am CT — compares each active tech's last-7d
// performance against their trailing 30d baseline. Alerts Teddy when
// a tech crosses a "significant drop" threshold on any of:
//   - First-visit-fix rate down >15 percentage points
//   - Callback rate up   >10 percentage points
//   - Avg customer rating down >0.8 points
//   - TDR completeness   down >20 percentage points
//
// Catches: tech burning out, tech making technique mistakes, tech
// going through personal stuff. Lets Teddy intervene early —
// coaching, time off, support — before customers feel it.
//
// Doesn't ALERT for new techs (<10 jobs in window — too noisy).

import { recordEvent } from '../xano.js';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const MIN_JOBS_FOR_SIGNAL = 10;
const THRESHOLDS = {
  fvfr_drop_pp: 15,
  callback_rise_pp: 10,
  rating_drop: 0.8,
  tdr_drop_pp: 20,
};

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let techs = [];
  try { techs = (await xano.getTechnicians()) || []; } catch (_) {}
  const active = techs.filter((t) => t.active && t.id !== 1 && t.id !== 8);

  const alerts = [];
  for (const tech of active) {
    let perf7d, perf30d;
    try {
      const r7 = await fetch(`${XANO_BASE}/get_tech_performance?tech_id=${tech.id}&days_back=7`, { signal: AbortSignal.timeout(8000) });
      if (r7.ok) perf7d = (await r7.json()) || null;
      const r30 = await fetch(`${XANO_BASE}/get_tech_performance?tech_id=${tech.id}&days_back=30`, { signal: AbortSignal.timeout(8000) });
      if (r30.ok) perf30d = (await r30.json()) || null;
    } catch (_) {}

    if (!perf7d || !perf30d) continue;
    if ((perf7d.jobs_count || 0) < MIN_JOBS_FOR_SIGNAL) continue;

    const issues = [];
    const fvfr7  = Number(perf7d.first_visit_fix_rate_pct ?? -1);
    const fvfr30 = Number(perf30d.first_visit_fix_rate_pct ?? -1);
    if (fvfr30 > 0 && fvfr7 > 0 && (fvfr30 - fvfr7) >= THRESHOLDS.fvfr_drop_pp) {
      issues.push(`first-visit-fix ${fvfr7}% (was ${fvfr30}%, ↓${fvfr30 - fvfr7}pp)`);
    }
    const cb7  = Number(perf7d.callback_rate_pct ?? -1);
    const cb30 = Number(perf30d.callback_rate_pct ?? -1);
    if (cb30 >= 0 && cb7 >= 0 && (cb7 - cb30) >= THRESHOLDS.callback_rise_pp) {
      issues.push(`callback rate ${cb7}% (was ${cb30}%, ↑${cb7 - cb30}pp)`);
    }
    const rt7  = Number(perf7d.avg_customer_rating ?? -1);
    const rt30 = Number(perf30d.avg_customer_rating ?? -1);
    if (rt30 > 0 && rt7 > 0 && (rt30 - rt7) >= THRESHOLDS.rating_drop) {
      issues.push(`rating ${rt7.toFixed(1)} (was ${rt30.toFixed(1)}, ↓${(rt30 - rt7).toFixed(1)})`);
    }
    const tdr7  = Number(perf7d.tdr_completeness_pct ?? -1);
    const tdr30 = Number(perf30d.tdr_completeness_pct ?? -1);
    if (tdr30 > 0 && tdr7 > 0 && (tdr30 - tdr7) >= THRESHOLDS.tdr_drop_pp) {
      issues.push(`TDR completeness ${tdr7}% (was ${tdr30}%, ↓${tdr30 - tdr7}pp)`);
    }

    if (issues.length > 0) {
      alerts.push({
        tech_id: tech.id,
        tech_name: tech.first_name,
        issues,
        jobs_7d: perf7d.jobs_count,
      });
    }
  }

  if (alerts.length === 0) {
    await xano.markSignalProcessed(signal.id, 'tech_performance_alert_handled', { alerts: 0 });
    log('tech_performance_alert_clean');
    return { success: true, action: 'no_alerts' };
  }

  const lines = [`[ant] weekly tech performance — ${alerts.length} tech(s) with drops:`];
  for (const a of alerts) {
    lines.push('');
    lines.push(`${a.tech_name} (${a.jobs_7d} jobs/7d):`);
    for (const issue of a.issues) lines.push(`  - ${issue}`);
  }
  lines.push('');
  lines.push('Review: tnapplianceexchange.net/tech-leaderboard.html');

  let smsResult;
  try { smsResult = await sms.toOwner(lines.join('\n'), { call_site: 'tech_performance_alert' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  for (const a of alerts) {
    try {
      await recordEvent('tech_performance_drop_flagged', {
        tech_id: a.tech_id, tech_name: a.tech_name, issues: a.issues, jobs_7d: a.jobs_7d,
        flagged_at_ms: Date.now(),
      });
    } catch (_) {}
  }

  await xano.markSignalProcessed(signal.id, 'tech_performance_alert_handled', {
    alerts_count: alerts.length, sms_ok: !!(smsResult && smsResult.ok),
  });
  log('tech_performance_alert_sent', { count: alerts.length });
  return { success: true, action: 'sent', count: alerts.length };
}
