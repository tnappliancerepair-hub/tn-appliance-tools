// SCHEDULER-SHADOW CRON (was: practice-auto-schedule-cron)
// Fires every 15 min via netlify.toml schedule. Calls mock-scheduler in
// DRY-RUN mode so we get a proposed plan without mutating jobs.technician_id
// / scheduled_start. No tech SMS fires (no APPOINTMENT_SCHEDULED signal),
// no customer SMS attempted.
//
// Purpose: measure auto-scheduling decision quality over the next few days
// while techs continue to follow HCP. Each run's summary is POSTed to
// record_scheduler_shadow_run for the efficiency report page.
//
// SquareTrade jobs continue to be treated as 'anchors' by mock-scheduler
// (ServicePower pre-sets the date) — they're NEVER re-routed even in
// shadow mode.

const SITE_BASE =
  process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

exports.handler = async function () {
  const runId = `shadow_cron_${Date.now()}`;
  const url = `${SITE_BASE}/.netlify/functions/mock-scheduler?dry_run=true&practice_mode=1&day_offset=1&limit=500&force_mock=1&run_id=${runId}`;

  try {
    const r = await fetch(url);
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = { raw: text.slice(0, 500) }; }

    const summary = (body && body.summary) || {};
    const targetDate = body && body.target_date;
    const planRows = (body && body.plan) || [];

    // Lean per-tech rollup for the efficiency report
    const byTech = {};
    for (const row of planRows) {
      const tid = row.technician_id || 0;
      if (!byTech[tid]) byTech[tid] = { count: 0, zips: new Set(), cities: new Set() };
      byTech[tid].count++;
      if (row.service_zip) byTech[tid].zips.add(row.service_zip);
      if (row.service_city) byTech[tid].cities.add(row.service_city);
    }
    const techRollup = Object.entries(byTech).map(([tid, x]) => ({
      technician_id: Number(tid),
      jobs_placed: x.count,
      distinct_zips: x.zips.size,
      distinct_cities: x.cities.size,
    }));

    // Audit-log the plan summary so the report page can read it
    try {
      await fetch(`${XANO_INTAKE}/record_scheduler_shadow_run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          target_date: targetDate,
          total_jobs_in: summary.total_jobs_in || 0,
          flexible_in: summary.flexible_in || 0,
          anchors_in: summary.anchors_in || 0,
          techs_active: summary.techs_active || 0,
          unrouted_count: summary.unrouted_count || 0,
          plan_size: planRows.length,
          tech_rollup: techRollup,
        }),
      });
    } catch (_) { /* fail-open, not fatal */ }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        triggered_at: new Date().toISOString(),
        run_id: runId,
        target_date: targetDate,
        plan_size: planRows.length,
        tech_rollup: techRollup,
        summary,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(e.message || e) }),
    };
  }
};
