'use strict';
// Vapi tool: get_tech_report_context — returns a job's CURRENT report (TDR) state
// so the "Ant Tech Report" voice assistant knows what's already filled (the
// customer's complaint, Teddy's pre-diagnosis, parts) and asks the tech ONLY for
// what's missing. Tech-facing: the diagnosis/part fields are exactly what the tech
// needs, so we surface them (the proxy's stripInternal only drops problem_summary/
// notes — we return the complaint under 'customer_complaint' so it survives).
//
// Routed through vapi-tool (NETLIFY_TOOLS), so this handler receives flat args.
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const has = (v) => v != null && String(v).trim() !== '';

exports.handler = async function (event) {
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || b.jobId || 0);
  if (!jobId) return ok({ error: 'job_id required', found: false });

  let d = {};
  try {
    const r = await fetch(`${XANO}/get_job_for_dashboard`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    d = await r.json();
  } catch (_) {
    return ok({ error: 'lookup_failed', found: false, job_id: jobId });
  }

  const job = d.job || {};
  const appl = d.appliance || {};
  const tdr = d.tdr || {};

  const ctx = {
    found: true,
    job_id: jobId,
    appliance: appl.appliance_type || job.appliance_type || '',
    brand: appl.brand || job.brand || '',
    model: appl.model_number || job.model_number || '',
    // renamed so the proxy's stripInternal doesn't drop it (it strips problem_summary)
    customer_complaint: job.problem_summary || appl.problem || '',
    pre_diagnosis: tdr.diagnosis || '',
    failed_component: tdr.failed_component || '',
    failure_cause: tdr.failure_cause || '',
    verified_part_number: tdr.verified_part_number || '',
    repair_completed: tdr.repair_completed || '',
    labor_time_hours: tdr.labor_time_hours || '',
  };

  // What still needs to come from the tech for a complete report.
  const missing = [];
  if (!has(ctx.pre_diagnosis)) missing.push('diagnosis — what was actually wrong');
  if (!has(ctx.failed_component)) missing.push('failed_component — the part that failed');
  if (!has(ctx.repair_completed)) missing.push('repair_completed — what you did / is it done');
  if (!has(ctx.verified_part_number)) missing.push('verified_part_number — the part you used');
  if (!has(ctx.labor_time_hours)) missing.push('labor_time_hours');
  ctx.still_needed = missing;

  return ok(ctx);
};

function ok(obj) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
