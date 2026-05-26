// Handles DAILY_REVENUE_SUMMARY signals (emitted by tick.js at 6pm CT
// — end-of-day window for the shop). Pulls today's completed jobs via
// the new get_daily_revenue_summary endpoint, computes per-tech counts +
// warranty/self-pay split, SMSes Teddy an EOD digest.
//
// Pricing dollars intentionally NOT computed here — jobs.total_owed
// varies in coverage and Stripe/Alyse own the financial reconciliation.
// This agent owns the operational visibility ("how many jobs cleared
// today"). The Business Intelligence colony (architect-built BI* agents)
// will add dollar-level intelligence later.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

function ctMidnightMs(nowTs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowTs));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const off = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', timeZoneName: 'shortOffset',
  }).formatToParts(probe);
  const offStr = (off.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-5';
  const m = offStr.match(/GMT([+-]\d+)/);
  const offHrs = m ? parseInt(m[1], 10) : -5;
  const [y, mo, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, 0 - offHrs, 0, 0);
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const sinceMs = Number(signal.payload?.since_ts_ms || ctMidnightMs(Date.now()));

  let summary;
  try {
    summary = await xano.getDailyRevenueSummary(sinceMs);
  } catch (err) {
    log('daily_revenue_summary_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'daily_revenue_summary_handled', { outcome: 'load_failed' });
    return { success: false, action: 'load_failed' };
  }

  const total = Number(summary.total_completed || 0);
  const warranty = Number(summary.warranty_count || 0);
  const selfPay = Number(summary.self_pay_count || 0);
  const jobs = Array.isArray(summary.jobs) ? summary.jobs : [];

  // Group counts per tech.
  const byTech = {};
  for (const j of jobs) {
    const tid = Number(j.tech_id || 0);
    if (!byTech[tid]) byTech[tid] = { total: 0, warranty: 0, self_pay: 0 };
    byTech[tid].total += 1;
    if (j.customer_type === 'warranty') byTech[tid].warranty += 1;
    else byTech[tid].self_pay += 1;
  }

  // Tech names (best-effort).
  let techList = [];
  try {
    const r = await xano.getTechnicians();
    techList = (r && r.items) || r || [];
  } catch (_) { /* labels fall back to id */ }
  const techName = (id) => {
    const t = techList.find((x) => Number(x.id) === Number(id));
    return t && t.first_name ? String(t.first_name).trim() : `Tech ${id || '?'}`;
  };

  const lines = [`[ant] EOD summary — ${total} job${total === 1 ? '' : 's'} completed`];
  lines.push(`  Warranty: ${warranty}  Self-pay: ${selfPay}`);
  const techIds = Object.keys(byTech).filter((k) => Number(k) > 0).map(Number);
  if (techIds.length > 0) {
    techIds.sort((a, b) => byTech[b].total - byTech[a].total);
    for (const tid of techIds.slice(0, 8)) {
      const c = byTech[tid];
      lines.push(`  ${techName(tid)}: ${c.total} (W:${c.warranty} / SP:${c.self_pay})`);
    }
  }

  const bareDomain = (config.publicSiteBase || '').replace(/^https?:\/\//, '');
  lines.push(`Calendar: ${bareDomain}/office-calendar.html?view=today`);
  const body = lines.join('\n');

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'daily_revenue_summary',
      total,
      warranty,
      self_pay: selfPay,
      tech_count: techIds.length,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog('daily_revenue_fired', {
      since_ts_ms: sinceMs,
      total_completed: total,
      warranty_count: warranty,
      self_pay_count: selfPay,
      tech_counts: byTech,
      sms_sent: !!(smsRes && smsRes.success),
    });
  } catch (_) { /* best-effort dedup */ }

  const meta = {
    outcome: 'eod_summary_sent',
    total,
    warranty,
    self_pay: selfPay,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'daily_revenue_summary_handled', meta);
  log('daily_revenue_summary_handled', meta);
  return { success: true, action: 'eod_summary_sent' };
}
