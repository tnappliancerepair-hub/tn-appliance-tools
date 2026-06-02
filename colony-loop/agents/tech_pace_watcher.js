// Signal in: TECH_PACE_CHECK
// Fires every 30 min during business hours via tick.js. For each active
// tech with jobs scheduled today + at least one started, computes
// ahead/behind using a simple 90min-per-stop heuristic (75min job +
// ~15min drive). Emits TECH_RUNNING_AHEAD or TECH_RUNNING_BEHIND per
// tech that crosses the threshold so Block 6's inserter / swapper
// agents can react.
//
// Bidirectional approval pattern lives in those Block 6 consumers,
// not here. This agent only observes + signals.

import { config } from '../config.js';

const AVG_MINUTES_PER_STOP = 90;       // 75min job + ~15min drive
const AHEAD_THRESHOLD_MIN = 20;
const BEHIND_THRESHOLD_MIN = 20;
const MIN_ELAPSED_BEFORE_JUDGING_MIN = 60;

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let techsResp;
  try {
    techsResp = await xano.getTechnicians();
  } catch (err) {
    const meta = { outcome: 'fetch_techs_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'tech_pace_check_handled', meta);
    return { success: false, action: 'fetch_techs_failed' };
  }

  const techs = Array.isArray(techsResp) ? techsResp : (techsResp.technicians || techsResp.items || []);
  const active = techs.filter(t => t && t.active);
  if (!active.length) {
    const meta = { outcome: 'no_active_techs' };
    await xano.markSignalProcessed(signal.id, 'tech_pace_check_handled', meta);
    return { success: true, action: 'no_active_techs' };
  }

  const results = [];
  const nowMs = Date.now();

  for (const tech of active) {
    try {
      const dash = await xano.getTechDailyDashboard(tech.id);
      if (!dash || dash.success === false) {
        results.push({ tech_id: tech.id, outcome: 'dashboard_failed' });
        continue;
      }
      const jobs = dash.jobs || [];
      if (!jobs.length) {
        results.push({ tech_id: tech.id, outcome: 'no_jobs_today' });
        continue;
      }

      // Find first started_at (sentinel that tech started the day)
      const firstStarted = jobs
        .map(j => j.job || j)
        .filter(j => j && j.job_started_at)
        .map(j => new Date(j.job_started_at).getTime())
        .filter(ts => !isNaN(ts))
        .sort((a, b) => a - b)[0];

      if (!firstStarted) {
        results.push({ tech_id: tech.id, outcome: 'not_started_yet' });
        continue;
      }

      const elapsedMin = (nowMs - firstStarted) / 60000;
      if (elapsedMin < MIN_ELAPSED_BEFORE_JUDGING_MIN) {
        results.push({ tech_id: tech.id, outcome: 'too_early', elapsed_min: Math.round(elapsedMin) });
        continue;
      }

      const completed = jobs
        .map(j => j.job || j)
        .filter(j => j && j.job_completed_at)
        .length;

      const remaining = jobs
        .map(j => j.job || j)
        .filter(j => j && !j.job_completed_at && (j.scheduling_status || '') !== 'canceled')
        .length;

      const expected = elapsedMin / AVG_MINUTES_PER_STOP;
      const deltaStops = completed - expected;
      const deltaMin = Math.round(deltaStops * AVG_MINUTES_PER_STOP);

      let outcome;
      if (deltaMin > AHEAD_THRESHOLD_MIN && remaining < jobs.length) {
        await xano.emitSignal({
          signal_type: 'TECH_RUNNING_AHEAD',
          signal_strength: 70,
          source_colony: 'tech_pace_watcher',
          target_colonies: '',
          payload: {
            tech_id: tech.id,
            tech_name: (tech.first_name || '') + ' ' + (tech.last_name || ''),
            minutes_ahead: deltaMin,
            completed,
            remaining,
            total_today: jobs.length,
          },
        });
        outcome = `ahead_${deltaMin}min`;
      } else if (deltaMin < -BEHIND_THRESHOLD_MIN && remaining > 0) {
        await xano.emitSignal({
          signal_type: 'TECH_RUNNING_BEHIND',
          signal_strength: 70,
          source_colony: 'tech_pace_watcher',
          target_colonies: '',
          payload: {
            tech_id: tech.id,
            tech_name: (tech.first_name || '') + ' ' + (tech.last_name || ''),
            minutes_behind: -deltaMin,
            completed,
            remaining,
            total_today: jobs.length,
          },
        });
        outcome = `behind_${-deltaMin}min`;
      } else {
        outcome = `on_pace_delta_${deltaMin}min`;
      }

      results.push({ tech_id: tech.id, name: tech.first_name, completed, remaining, outcome });
    } catch (e) {
      results.push({ tech_id: tech.id, outcome: 'error', error: String(e.message || e) });
    }
  }

  const meta = { outcome: 'tech_pace_checked', results };
  await xano.markSignalProcessed(signal.id, 'tech_pace_check_handled', meta);
  log('tech_pace_check_handled', meta);
  return { success: true, action: 'tech_pace_check_handled', results };
}
