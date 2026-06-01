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
    // mock-scheduler returns plan as result[tech_id].eval.stops, plus
    // result[tech_id].overflow for jobs that didn't fit (capacity cap).
    const result = (body && body.result) || {};
    const techRollup = [];
    let totalPlaced = 0;
    let totalOverflow = 0;
    let totalDrive = 0;
    for (const tid of Object.keys(result)) {
      const t = result[tid] || {};
      const stops = (t.eval && t.eval.stops) || [];
      const overflow = t.overflow || [];
      const cities = new Set();
      for (const s of stops) {
        const town = (s.job && s.job.town) || '';
        if (town) cities.add(town);
      }
      const drive = (t.eval && t.eval.totalDrive) || 0;
      totalPlaced += stops.length;
      totalOverflow += overflow.length;
      totalDrive += drive;
      techRollup.push({
        technician_id: Number(tid),
        tech_name: (t.tech && t.tech.name) || '',
        cluster: (t.tech && t.tech.cluster) || '',
        jobs_placed: stops.length,
        overflow: overflow.length,
        drive_minutes: drive,
        distinct_cities: cities.size,
        cities: Array.from(cities).join(', '),
      });
    }

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
          plan_size: totalPlaced,
          overflow_total: totalOverflow,
          drive_total_minutes: totalDrive,
          tech_rollup: JSON.stringify(techRollup),
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
        plan_size: totalPlaced,
        overflow_total: totalOverflow,
        drive_total_minutes: totalDrive,
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
