import { config } from '../config.js';
import { fmtCT } from '../time.js';
import { normalizeE164 } from '../sms.js';

const APPLIANCE_NICE = {
  refrigerator: 'refrigerator',
  fridge: 'refrigerator',
  washer: 'washer',
  dryer: 'dryer',
  dishwasher: 'dishwasher',
  range: 'range',
  oven: 'oven',
  stove: 'stove',
  microwave: 'microwave',
};

function bareDomain() {
  return config.publicSiteBase.replace(/^https?:\/\//, '');
}

function fmtSchedule(ts) {
  if (!ts) return '(not scheduled)';
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '(not scheduled)';
  return fmtCT(n) + ' CT';
}

function fmtAddress(job) {
  const parts = [
    (job.service_address || '').trim(),
    (job.service_city || '').trim(),
    (job.service_state || '').trim(),
    (job.service_zip || '').trim(),
  ].filter(Boolean);
  if (parts.length === 0) return '(no address on file)';
  // City, state on one line if all present; otherwise concat what we have
  const street = parts[0];
  const rest = parts.slice(1).join(', ');
  return rest ? `${street}, ${rest}` : street;
}

function composeBody({ job, customer, tech, isReassignment, jobLabel }) {
  const custName =
    [(customer?.last_name || '').trim(), (customer?.first_name || '').trim()]
      .filter(Boolean)
      .join(', ') || '(no customer name)';
  const applianceRaw = (job.appliance_type || '').trim().toLowerCase();
  const appliance = APPLIANCE_NICE[applianceRaw] || applianceRaw || 'appliance';
  const issue = (job.problem_summary || '').trim() || '(no problem summary)';
  const header = isReassignment
    ? `[ant] reassigned to you - job #${jobLabel}`
    : `[ant] new job assigned - #${jobLabel}`;
  const link = `${bareDomain()}/tech-ant-live.html?job_id=${job.id}&tech_id=${tech.id}`;
  return [
    header,
    `${custName} - ${appliance}`,
    fmtAddress(job),
    `Issue: ${issue}`,
    `Scheduled: ${fmtSchedule(job.scheduled_start)}`,
    `Tech Ant: ${link}`,
  ].join('\n');
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const technicianId = Number(payload.technician_id);
  const priorTechnicianId =
    payload.prior_technician_id == null ? null : Number(payload.prior_technician_id);

  if (!jobId) throw new Error('payload.job_id required');
  if (!technicianId) throw new Error('payload.technician_id required');

  // Q4: skip Teddy (tech_id=1) only when this is a first-assignment fallback.
  // Explicit reassignment TO Teddy (priorTechnicianId set) still notifies.
  if (technicianId === 1 && priorTechnicianId == null) {
    log('tech_assignment_handled', {
      job_id: jobId,
      technician_id: technicianId,
      outcome: 'skipped_owner_fallback',
    });
    return { success: true, action: 'skipped_owner_fallback', job_id: jobId };
  }

  // No-op: same tech as before.
  if (priorTechnicianId != null && priorTechnicianId === technicianId) {
    log('tech_assignment_handled', {
      job_id: jobId,
      technician_id: technicianId,
      outcome: 'skipped_same_tech',
    });
    return { success: true, action: 'skipped_same_tech', job_id: jobId };
  }

  const handled = await xano.getTechAssignmentHandled(jobId, technicianId);
  if (handled && handled.handled) {
    return {
      success: true,
      action: 'skipped_duplicate',
      job_id: jobId,
      technician_id: technicianId,
      last_handled_at: handled.last_handled_at,
    };
  }

  const ctxData = await xano.getTechAssignmentContext(jobId, technicianId);
  if (!ctxData || !ctxData.success) {
    log('tech_assignment_handled', {
      job_id: jobId,
      technician_id: technicianId,
      outcome: 'context_load_failed',
      error: ctxData?.error || 'unknown',
    });
    return { success: false, action: 'context_load_failed', job_id: jobId, error: ctxData?.error };
  }
  const { job, customer, tech } = ctxData;
  const jobLabel = job.job_number || String(job.id);

  const techPhone = normalizeE164(tech?.phone);
  if (!techPhone) {
    const meta = {
      job_id: jobId,
      technician_id: technicianId,
      outcome: 'invalid_tech_phone',
      raw_phone: tech?.phone || null,
    };
    await xano.markSignalProcessed(signal.id, 'tech_assignment_handled', meta);
    log('tech_assignment_handled', meta);
    return { success: false, action: 'invalid_tech_phone', job_id: jobId, technician_id: technicianId };
  }

  const isReassignment = priorTechnicianId != null;
  const body = composeBody({ job, customer, tech, isReassignment, jobLabel });

  const smsRes = await sms.toTech(techPhone, body, {
    action: 'tech_assignment_notification',
    job_id: jobId,
    technician_id: technicianId,
    prior_technician_id: priorTechnicianId,
    source_signal_id: signal.id,
    is_reassignment: isReassignment,
  });

  // Customer-direction SMS — ONLY on reassignment of an already-scheduled
  // job (so the customer learns their tech changed). New assignments don't
  // need this — the customer either hasn't been told yet or learns via
  // appointment_scheduled confirmation. Skip if scheduled_start is null
  // (no appointment locked in yet → no expectation to update).
  let custReassignRes = null;
  if (isReassignment && job.scheduled_start != null && Number(job.scheduled_start) > 0) {
    const custPhone = normalizeE164(customer?.phone);
    if (custPhone) {
      const custFirst = String((customer && customer.first_name) || '').trim() || 'there';
      const techFirst = String((tech && tech.first_name) || '').trim() || 'our tech';
      const apptDate = new Date(Number(job.scheduled_start)).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
      const apl = (job.appliance_type || 'appliance').toLowerCase();
      const custBody =
        `Hi ${custFirst} - quick update: ${techFirst} will now be the tech for your ${apl} appointment ` +
        `on ${apptDate} CT. Same time, just a different tech. Questions? Call 615-280-2949.`;
      try {
        custReassignRes = await sms.toCustomer(custPhone, custBody, {
          action: 'tech_reassign_customer_notice',
          job_id: jobId,
          technician_id: technicianId,
          prior_technician_id: priorTechnicianId,
          source_signal_id: signal.id,
        });
      } catch (err) {
        custReassignRes = { success: false, error: String(err.message || err) };
      }
    }
  }

  const finalMeta = {
    job_id: jobId,
    technician_id: technicianId,
    prior_technician_id: priorTechnicianId,
    outcome: isReassignment ? 'reassign_notified' : 'assign_notified',
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    customer_reassign_sms: custReassignRes ? (custReassignRes.success ? 'ok' : 'maybe_failed') : 'skipped',
  };
  await xano.markSignalProcessed(signal.id, 'tech_assignment_handled', finalMeta);
  log('tech_assignment_handled', finalMeta);

  return {
    success: true,
    action: finalMeta.outcome,
    job_id: jobId,
    technician_id: technicianId,
  };
}
