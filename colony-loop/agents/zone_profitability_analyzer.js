// Signal in: ZONE_PROFITABILITY_ANALYSIS
// Fires monthly (1st of month, 10-11am CT). Groups jobs by service_zip
// over the last 60 days, computes total revenue + avg ticket + completion
// rate per zip. Surfaces:
//   - zips that are losing money (low avg ticket, high cancel rate)
//   - zips that are most profitable (high avg ticket, high volume)
//
// PARTIAL DATA — drive cost is not currently tracked per job. The
// analyzer reports gross revenue per zip, not net profit. Adding a
// drive-time estimator (haversine zip → tech home base × per-mile cost)
// would convert this into true profit. Flagged in the SMS so Teddy
// reads it as "gross indicator, not net P&L."

import { config } from '../config.js';

const INTAKE = (path) => `${config.xanoIntakeBase}${path}`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let summary;
  try {
    const r = await fetch(INTAKE('/get_zone_profitability_summary?days_back=60'));
    summary = await r.json();
  } catch (err) {
    const meta = { outcome: 'fetch_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'zone_profitability_handled', meta);
    log('zone_profitability_fetch_failed', meta);
    return { success: false, action: 'fetch_failed' };
  }

  const rows = (summary && summary.rows) || [];
  if (rows.length === 0) {
    await xano.markSignalProcessed(signal.id, 'zone_profitability_handled', { outcome: 'no_data' });
    return { success: true, action: 'no_data' };
  }

  const byZip = {};
  for (const j of rows) {
    const zip = (j.service_zip || '').trim();
    if (!zip) continue;
    if (!byZip[zip]) byZip[zip] = { jobs: 0, revenue_cents: 0, completed: 0, canceled: 0, cities: new Set() };
    byZip[zip].jobs += 1;
    byZip[zip].revenue_cents += Number(j.total_amount_cents || 0);
    const status = (j.scheduling_status || '').toLowerCase();
    if (status === 'completed') byZip[zip].completed += 1;
    if (status === 'canceled') byZip[zip].canceled += 1;
    if (j.service_city) byZip[zip].cities.add(j.service_city);
  }

  const ranked = Object.entries(byZip).map(([zip, m]) => ({
    zip,
    city: Array.from(m.cities).join(',').slice(0, 30),
    jobs: m.jobs,
    revenue_cents: m.revenue_cents,
    avg_ticket_cents: Math.round(m.revenue_cents / Math.max(m.jobs, 1)),
    completion_rate: m.completed / Math.max(m.jobs, 1),
    cancel_rate: m.canceled / Math.max(m.jobs, 1),
  }));

  const byRevenue = [...ranked].sort((a, b) => b.revenue_cents - a.revenue_cents);
  const problemZips = ranked.filter((z) => z.jobs >= 3 && (z.avg_ticket_cents < 8000 || z.cancel_rate > 0.30));

  const fmtMoney = (c) => '$' + Math.round(c / 100);
  const fmtPct = (p) => Math.round(p * 100) + '%';

  const top3 = byRevenue.slice(0, 3).map((z) => `${z.zip} (${z.city || '?'}): ${z.jobs}j ${fmtMoney(z.revenue_cents)} (avg ${fmtMoney(z.avg_ticket_cents)})`).join('; ');
  const problemSummary = problemZips.length > 0
    ? `⚠️ ${problemZips.length} problem zips (low ticket OR high cancel)`
    : 'No problem zips flagged';

  const body = `[ant] zone profit (last 60d, gross — drive cost not yet tracked). Top: ${top3}. ${problemSummary}.`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'zone_profitability_digest',
        zip_count: ranked.length,
        problem_zip_count: problemZips.length,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      smsResult = String(e.message || e);
    }
  }

  const meta = {
    outcome: 'digest_sent',
    zip_count: ranked.length,
    problem_zips: problemZips.map((z) => ({ zip: z.zip, city: z.city, avg_cents: z.avg_ticket_cents, cancel_rate: z.cancel_rate })),
    top_5: byRevenue.slice(0, 5).map((z) => ({ zip: z.zip, city: z.city, jobs: z.jobs, revenue_cents: z.revenue_cents })),
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'zone_profitability_handled', meta);
  log('zone_profitability_handled', meta);
  return { success: true, action: 'zone_profitability_handled' };
}
