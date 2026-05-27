// Step 5 — daily parallel test job assigner. Fires at 6am CT from
// tick.js. Loops the 5 active techs and calls assign_parallel_test_job
// for each. Logs per-tech outcome.
const ACTIVE_TECH_IDS = [2, 3, 4, 5, 6];

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const results = {};

  for (const techId of ACTIVE_TECH_IDS) {
    try {
      const res = await xano.assignParallelTestJob(techId);
      results[techId] = res && res.action ? res.action : 'unknown';
    } catch (err) {
      results[techId] = `error: ${String(err.message || err).slice(0, 60)}`;
      log('assign_parallel_test_failed', { tech_id: techId, error: String(err.message || err) });
    }
  }

  const meta = { outcome: 'assignments_processed', results, count: ACTIVE_TECH_IDS.length };
  await xano.markSignalProcessed(signal.id, 'assign_parallel_test_jobs_handled', meta);
  log('assign_parallel_test_jobs_handled', meta);

  return { success: true, action: meta.outcome, ...meta };
}
