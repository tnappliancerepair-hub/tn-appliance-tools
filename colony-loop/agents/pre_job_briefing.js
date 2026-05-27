// PRE_JOB_BRIEFING agent — proactive teammate move.
//
// Fires once per job when the tech taps "Start Job" on tech-ant-live.
// Pulls (a) job context, (b) common failures for the brand+appliance,
// (c) the customer's prior service history. Composes ONE short SMS to
// the tech with the most useful 30-second briefing we can give.
//
// Tone: silent expert handing the tech a quick read on the way in.
// Brief. Specific. Useful. Never "good luck out there" filler.
//
// Dedup: skipped for now — tech_job_started_POST won't emit twice for
// the same job because the job's state flips to in_progress on first
// tap. If we see duplicates in practice, add count_pending_signals
// dedup like the other hold-and-re-emit agents.
import { config } from '../config.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'claude-haiku-4-5-20251001';   // briefing is short + cheap; haiku is fine
const MAX_BRIEFING_CHARS = 320;
const INTAKE = () => config.xanoIntakeBase;

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const techId = Number(payload.technician_id);
  if (!jobId || !techId) {
    await xano.markSignalProcessed(signal.id, 'pre_job_briefing_handled', { outcome: 'skipped_missing_ids' });
    return { success: true, action: 'skipped_missing_ids' };
  }

  // Dedup: count of OTHER pending PRE_JOB_BRIEFING signals for this job.
  // If > 1, this is a duplicate — skip without re-sending.
  try {
    const counts = await xano.countPendingSignalsForJob('PRE_JOB_BRIEFING', jobId);
    if (counts && counts.pending_count > 1) {
      log('pre_job_briefing_dedup_skip', { job_id: jobId, pending: counts.pending_count });
      await xano.markSignalProcessed(signal.id, 'pre_job_briefing_handled', { job_id: jobId, outcome: 'dedup_skip' });
      return { success: true, action: 'dedup_skip' };
    }
  } catch (_) { /* dedup best-effort */ }

  // Pull job context
  const job = await fetch(`${INTAKE()}/get_job?job_id=${jobId}`).then((r) => r.json()).catch(() => null);
  if (!job || !job.id) {
    await xano.markSignalProcessed(signal.id, 'pre_job_briefing_handled', { job_id: jobId, outcome: 'job_not_found' });
    return { success: false, action: 'job_not_found' };
  }

  const brand = (job.brand || '').trim();
  const appliance = (job.appliance_type || '').trim();
  const model = (job.model || job.model_number || '').trim();
  const problem = (job.problem_summary || '').trim();
  const customerId = job.customer_id || 0;

  // Pull common failures + customer history (parallel)
  const [failuresRes, historyRes] = await Promise.all([
    brand
      ? fetch(`${INTAKE()}/get_common_failures?brand=${encodeURIComponent(brand)}&appliance_type=${encodeURIComponent(appliance)}&model_number=${encodeURIComponent(model)}&per_page=5`).then((r) => r.json()).catch(() => null)
      : Promise.resolve(null),
    customerId
      ? fetch(`${INTAKE()}/assist_get_customer_history?customer_id=${customerId}&exclude_job_id=${jobId}&limit=5`).then((r) => r.json()).catch(() => null)
      : Promise.resolve(null),
  ]);

  const commonFailures = (failuresRes && failuresRes.entries) || [];
  const priorJobs = (historyRes && historyRes.items) || [];

  // Get tech first name + phone via getTechnicians (returns full list)
  const allTechs = await xano.getTechnicians().catch(() => []);
  const tech = (Array.isArray(allTechs) ? allTechs : []).find((t) => Number(t.id) === techId);
  const techFirstName = (tech && (tech.first_name || tech.name || '').trim()) || 'tech';
  const techPhone = tech && tech.phone ? tech.phone : null;

  if (!techPhone) {
    log('pre_job_briefing_no_phone', { job_id: jobId, tech_id: techId });
    await xano.markSignalProcessed(signal.id, 'pre_job_briefing_handled', { job_id: jobId, outcome: 'no_tech_phone' });
    return { success: false, action: 'no_tech_phone' };
  }

  // Build the briefing via Claude (no tools needed — data inlined)
  const briefing = await composeBriefing({
    techFirstName,
    brand, appliance, model, problem,
    commonFailures,
    priorJobs,
    customerFirst: (job.customer_first_name || job.customer_first || '').trim() || 'customer',
  });

  if (!briefing) {
    log('pre_job_briefing_compose_failed', { job_id: jobId });
    await xano.markSignalProcessed(signal.id, 'pre_job_briefing_handled', { job_id: jobId, outcome: 'compose_failed' });
    return { success: false, action: 'compose_failed' };
  }

  // SMS the tech (internal recipient — bypasses CUSTOMER_FACING gate)
  try {
    await xano.sendSms(techPhone, briefing, {
      context_tag: 'pre_job_briefing',
      recipient_role: 'tech',
    });
  } catch (err) {
    log('pre_job_briefing_sms_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'pre_job_briefing_handled', { job_id: jobId, outcome: 'sms_failed' });
    return { success: false, action: 'sms_failed' };
  }

  await xano.markSignalProcessed(signal.id, 'pre_job_briefing_sent', {
    job_id: jobId,
    tech_id: techId,
    char_count: briefing.length,
    failures_count: commonFailures.length,
    prior_jobs_count: priorJobs.length,
  });
  return { success: true, action: 'sent', job_id: jobId, chars: briefing.length };
}

async function composeBriefing({ techFirstName, brand, appliance, model, problem, commonFailures, priorJobs, customerFirst }) {
  if (!ANTHROPIC_KEY) return null;

  const failuresLines = commonFailures.slice(0, 4).map((f, i) => `${i+1}. ${f.failed_component || '?'} (${f.count || 0}x, cause: ${(f.failure_cause || '').slice(0,60)}${f.verified_part_number ? `, part: ${f.verified_part_number}` : ''})`).join('\n');
  const priorLines = priorJobs.slice(0, 3).map((p) => `${p.scheduled_start ? new Date(p.scheduled_start).toLocaleDateString('en-US', {month:'short', year:'numeric'}) : 'past'}: ${p.tech_first_name || 'tech'} did ${p.tdr_failed || p.appliance || 'work'}${p.tdr_repair ? ` (${p.tdr_repair.slice(0,40)})` : ''}`).join('\n');
  const modelClean = model && model.length < 25 ? model : '';
  const partsLink = modelClean ? `searspartsdirect.com/model/${modelClean}/parts` : '';

  const sysPrompt = `You are Ant, a silent expert briefing a TN Appliance tech 30 seconds before they walk into a customer's house. ONE SMS only. Under ${MAX_BRIEFING_CHARS} chars. NO greeting, NO "good luck", NO filler — just the briefing.

Style:
- Lead with tech first name + customer name: "${techFirstName} — at ${customerFirst}'s for the ${appliance.toLowerCase() || 'appliance'}."
- Then the most useful thing you know: top likely cause(s) if there's failure data; OR what we did last time if there's history; OR just the brand/model/parts link if neither.
- Include parts link if known: ${partsLink || '(no model yet)'}
- ZERO advice they already know. No "check power first." No "be safe."
- If failure data exists, lead with the top 1-2 with part numbers.
- If prior service exists for this customer, mention what we did last + suggest verifying it didn't re-fail.
- Plain text. No markdown. No emoji beyond maybe one at end.`;

  const userPrompt = `Brand: ${brand || '?'}
Appliance: ${appliance || '?'}
Model: ${model || '?'}
Problem reported: ${problem || '?'}
Customer first name: ${customerFirst}

Top common failures we've seen on this brand+appliance (most → least common):
${failuresLines || '(no failure data yet for this brand+appliance combo)'}

This customer's prior service with us (most → least recent):
${priorLines || '(first job for this customer)'}

Compose the briefing SMS now.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: sysPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = ((data.content || []).find((b) => b.type === 'text') || {}).text || '';
    return text.trim().slice(0, MAX_BRIEFING_CHARS);
  } catch (_) {
    return null;
  }
}
