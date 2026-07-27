import { config } from '../config.js';
import { normalizeE164 } from '../sms.js';

function fmtTimeShort(ms) {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function bareDomain() {
  return config.publicSiteBase.replace(/^https?:\/\//, '');
}

function composeBody({ first, jobCount, firstTimeStr, techId }) {
  const name = (first || '').trim().toLowerCase() || 'there';
  const jobsWord = jobCount === 1 ? 'job' : 'jobs';
  const firstClause = jobCount > 0 && firstTimeStr ? `, first at ${firstTimeStr}` : '';
  return `[ant] morning ${name} — ${jobCount} ${jobsWord} today${firstClause}.\nYour day: ${bareDomain()}/tech-daily-dashboard.html?tech_id=${techId}`;
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  const techList = await xano.getTechnicians();
  if (!Array.isArray(techList)) {
    throw new Error('technicians endpoint did not return a list');
  }

  const results = [];
  for (const t of techList) {
    if (!t || !t.active) continue;
    const techId = t.id;
    if (!techId) continue;
    // Skip orphan rows (no name)
    if (!t.first_name || !String(t.first_name).trim()) continue;
    // 2026-06-02: skip tech_id=1 (Teddy-as-tech). Owner already sees
    // everything via Teddy Tool heads-ups + per-job signals; the daily
    // briefing is pure noise on his phone (accumulated ~1340 messages).
    if (techId === 1) {
      results.push({ tech_id: techId, outcome: 'skipped_owner_is_tech' });
      continue;
    }

    let dash;
    try {
      dash = await xano.getTechDailyDashboard(techId);
    } catch (err) {
      log('daily_tech_briefing_load_failed', { tech_id: techId, error: err.message });
      results.push({ tech_id: techId, outcome: 'load_failed' });
      continue;
    }

    if (!dash || dash.success !== true) {
      log('daily_tech_briefing_load_failed', { tech_id: techId, error: dash?.error || 'unknown' });
      results.push({ tech_id: techId, outcome: 'load_failed' });
      continue;
    }

    const jobCount = Number(dash.job_count) || 0;
    if (jobCount === 0) {
      results.push({ tech_id: techId, outcome: 'skipped_no_jobs' });
      continue;
    }

    const firstJob = (dash.jobs && dash.jobs[0]) || null;
    const firstTimeStr = firstJob && firstJob.job ? fmtTimeShort(firstJob.job.scheduled_start) : '—';

    const techPhone = normalizeE164(t.phone);
    if (!techPhone) {
      log('daily_tech_briefing_invalid_phone', { tech_id: techId, raw_phone: t.phone || null });
      results.push({ tech_id: techId, outcome: 'invalid_phone' });
      continue;
    }

    const body = composeBody({
      first: t.first_name,
      jobCount,
      firstTimeStr,
      techId,
    });

    // Never let one tech's send throw the whole run — if it does, the run never
    // reaches markSignalProcessed, the dedup marker never lands, and the tick
    // re-fires the briefing every 60s (inbox spam). Isolate each send.
    let smsRes = null;
    try {
      smsRes = await sms.toTech(techPhone, body, {
        action: 'daily_tech_briefing',
        tech_id: techId,
        job_count: jobCount,
        source_signal_id: signal.id,
      });
    } catch (err) {
      log('daily_tech_briefing_send_failed', { tech_id: techId, error: err && err.message });
      results.push({ tech_id: techId, outcome: 'send_failed' });
      continue;
    }

    log('daily_tech_briefing_sent', {
      tech_id: techId,
      job_count: jobCount,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
    results.push({
      tech_id: techId,
      outcome: 'sent',
      job_count: jobCount,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
  }

  const sent = results.filter((r) => r.outcome === 'sent').length;
  const skipped = results.filter((r) => r.outcome === 'skipped_no_jobs').length;
  const failed = results.filter((r) => r.outcome === 'load_failed' || r.outcome === 'invalid_phone').length;

  await xano.markSignalProcessed(signal.id, 'daily_tech_briefing_fired', {
    sent,
    skipped_no_jobs: skipped,
    failed,
    per_tech: results,
  });

  log('daily_tech_briefing_summary', { sent, skipped_no_jobs: skipped, failed });

  return {
    success: true,
    action: 'daily_tech_briefing_fired',
    sent,
    skipped_no_jobs: skipped,
    failed,
  };
}
