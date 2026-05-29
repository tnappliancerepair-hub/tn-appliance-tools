// PRE-JOB INTELLIGENCE PRE-STAGER
//
// Nightly at 9:30pm CT — for every job scheduled for tomorrow (across
// active techs), runs the embedding-based similar-jobs lookup + brand
// fingerprint + warranty fingerprint + customer history + distills it
// into a pre_job_intelligence event_log row keyed to the job.
//
// Tech Assist reads this at session start instead of running 4 lookups
// at the bedside. Caches overnight compute that would otherwise hit
// at 7:30am when techs open their dashboards.
//
// Why this matters: a job that took 90min because the tech had to
// remember 3 similar past dishwashers becomes a 40min job when the
// brain hands them "3 similar Whirlpool VMW drain-issue jobs from the
// past year — in all 3 the trap was clogged, pump replacement was
// unnecessary."
//
// Single agent does the work for all of tomorrow's jobs in one run.

import { listRecentEventLog, recordEvent, getJobForDashboard, getCustomerChannelPreference } from '../xano.js';

const CT_TZ = 'America/Chicago';
const SIMILAR_JOBS_NETLIFY = 'https://tnapplianceexchange.net/.netlify/functions/find-similar-jobs';

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  // Pull tomorrow's scheduled jobs across all active techs. The
  // dashboard endpoint already does the heavy join — reuse it per tech.
  const techs = await xano.getTechnicians().catch(() => []);
  const active = (techs || []).filter((t) => t.active && t.id !== 1 && t.id !== 8);

  // Tomorrow's CT date
  const nowCt = new Date();
  const tomorrowDate = ctDateString(new Date(nowCt.getTime() + 24 * 3600 * 1000));

  let staged = 0;
  let skipped = 0;
  let failures = 0;

  for (const tech of active) {
    let dash;
    try { dash = await xano.getTechDailyDashboard(tech.id, tomorrowDate); }
    catch (_) { failures += 1; continue; }
    const jobs = (dash && dash.jobs) || [];

    for (const jobBundle of jobs) {
      const job = jobBundle.job || {};
      if (!job.id) continue;

      // Dedup — don't re-stage if we already wrote intel for this
      // (job, tomorrow) pair in the last 12 hours.
      const dedup = await xano.checkEventLogFiredToday({
        action: `pre_job_intelligence_${job.id}`,
        since_ts_ms: Date.now() - 12 * 3600 * 1000,
      }).catch(() => ({ fired_today: false }));
      if (dedup && dedup.fired_today) { skipped += 1; continue; }

      // Gather context. Each fetch is independent — failure of one
      // shouldn't drop the others.
      const [similar, channelPref] = await Promise.all([
        fetchSimilarJobs(job.id).catch(() => null),
        getCustomerChannelPreference(job.customer_id || 0).catch(() => null),
      ]);

      const summary = distill({
        job,
        tech_first_name: tech.first_name,
        similar_jobs: similar,
        channel_pref: channelPref,
      });

      try {
        await recordEvent(`pre_job_intelligence_${job.id}`, {
          job_id: job.id,
          tech_id: tech.id,
          appliance: job.appliance_type || '',
          brand: job.brand || '',
          model_number: job.model_number || '',
          warranty_company: job.warranty_company || '',
          similar_count: (similar && similar.items) ? similar.items.length : 0,
          channel_pref: channelPref && channelPref.prefers || 'unknown',
          summary,
          staged_at_ms: Date.now(),
        });
        staged += 1;
      } catch (_) { failures += 1; }
    }
  }

  await xano.markSignalProcessed(signal.id, 'pre_job_intelligence_prestager_handled', {
    staged, skipped, failures,
  });
  log('pre_job_intelligence_prestager_handled', { staged, skipped, failures });
  return { success: true, action: 'staged', count: staged };
}

async function fetchSimilarJobs(jobId) {
  try {
    const r = await fetch(SIMILAR_JOBS_NETLIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, limit: 3 }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

function distill({ job, tech_first_name, similar_jobs, channel_pref }) {
  const lines = [];
  const appl = [job.brand, job.appliance_type].filter(Boolean).join(' ') || 'appliance';
  lines.push(`Job #${job.id} (${appl}${job.model_number ? ', model ' + job.model_number : ''})`);
  if (job.problem_summary) lines.push(`Stated problem: ${job.problem_summary.slice(0, 200)}`);

  if (similar_jobs && Array.isArray(similar_jobs.items) && similar_jobs.items.length > 0) {
    lines.push('');
    lines.push(`Similar past jobs (top ${similar_jobs.items.length}):`);
    for (const sim of similar_jobs.items.slice(0, 3)) {
      const sims = sim.summary || sim.text || (sim.diagnosis ? sim.diagnosis.slice(0, 140) : '');
      if (sims) lines.push(`  • ${sims}`);
    }
  }

  if (channel_pref && channel_pref.prefers && channel_pref.prefers !== 'unknown') {
    lines.push('');
    lines.push(`Customer comms preference: ${channel_pref.prefers}`);
  }

  if (job.warranty_company) {
    lines.push('');
    lines.push(`Warranty: ${job.warranty_company}${job.claim_number ? ' claim #' + job.claim_number : ''}`);
    lines.push(`Pre-collect what this vendor needs — call get_warranty_vendor_fingerprint("${job.warranty_company}") before asking ${tech_first_name} for diagnostic info.`);
  }

  return lines.join('\n');
}

function ctDateString(d) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // YYYY-MM-DD
}
