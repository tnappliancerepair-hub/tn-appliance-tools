// Handles TDR_QUALITY_CHECK signals (emitted by job_completed.js as a
// chain step). Two responsibilities:
//
//   1. If the TDR is INCOMPLETE for warranty submission:
//      → SMS the assigned tech (not Danielle) with the exact missing fields
//        and a deep link to tech-ant-live so they can fix it.
//
//   2. If the TDR is COMPLETE:
//      → emit TDR_COMPLETE for the warranty_router agent (BUILD 3) to
//        consume and auto-submit the claim to the right vendor.
//
// Only fires for warranty jobs — self-pay completions skip with reason
// "skipped_not_warranty" since they have no claim downstream.
import { config } from '../config.js';
import { toTech, normalizeE164 } from '../sms.js';

const HANDLED_VENDORS = new Set(['ahs', 'servicepower', 'squaretrade', 'frontdoor']);

const REQUIRED_TDR_FIELDS = [
  'diagnosis',
  'failed_component',
  'failure_cause',
  'diagnostic_test_performed',
  'labor_time_hours',
  'repair_completed',
];

function checkCompleteness(job, tdr, vendor) {
  if (!tdr) return ['tdr_missing'];
  const missing = [];
  for (const f of REQUIRED_TDR_FIELDS) {
    const v = tdr[f];
    if (v == null || v === '' || (f === 'labor_time_hours' && Number(v) <= 0)) {
      missing.push(f);
    }
  }
  if (!job.claim_number) missing.push('claim_number');
  if (vendor === 'ahs' && !job.warranty_vendor_id) missing.push('warranty_vendor_id');
  if (vendor === 'servicepower' && !job.dispatch_source_id) missing.push('dispatch_source_id');
  return missing;
}

function bareDomain() {
  return config.publicSiteBase.replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const vendor = String(payload.vendor || '').toLowerCase().replace(/\s+/g, '');
  const technicianId = Number(payload.technician_id || 0);

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'tdr_quality_check_handled', {
      outcome: 'skipped_missing_job_id',
    });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  if (!vendor || !HANDLED_VENDORS.has(vendor)) {
    const meta = { job_id: jobId, outcome: 'skipped_not_warranty', vendor };
    await xano.markSignalProcessed(signal.id, 'tdr_quality_check_handled', meta);
    log('tdr_quality_check_handled', meta);
    return { success: true, action: 'skipped_not_warranty', job_id: jobId };
  }

  const ctxData = await xano.getWarrantySubmissionContext(jobId);
  if (!ctxData || !ctxData.success || !ctxData.job) {
    const meta = { job_id: jobId, outcome: 'context_load_failed' };
    await xano.markSignalProcessed(signal.id, 'tdr_quality_check_handled', meta);
    log('tdr_quality_check_handled', meta);
    return { success: false, action: 'context_load_failed', job_id: jobId };
  }
  const { job, tdr } = ctxData;
  const missing = checkCompleteness(job, tdr, vendor);

  if (missing.length > 0) {
    // SMS the assigned tech (skip Teddy as tech_id=1 — owner-side already
    // gets the Danielle digest from job_completed.js).
    let smsRes = null;
    if (technicianId > 0 && technicianId !== 1) {
      try {
        const techs = await xano.getTechnicians();
        const list = (techs && techs.items) || techs || [];
        const tech = list.find((t) => t && t.id === technicianId);
        const techPhone = tech ? normalizeE164(tech.phone) : null;
        if (techPhone) {
          const link = `${bareDomain()}/tech-ant-live.html?job_id=${jobId}&tech_id=${technicianId}`;
          const body =
            `[ant] job #${jobId} TDR incomplete: ${missing.join(', ')}. ` +
            `Complete before warranty submits: ${link}`;
          smsRes = await toTech(techPhone, body, {
            action: 'tdr_incomplete_tech_alert',
            job_id: jobId,
            technician_id: technicianId,
            missing,
            source_signal_id: signal.id,
          });
        }
      } catch (err) {
        smsRes = { success: false, error: String(err.message || err) };
      }
    }

    const meta = {
      job_id: jobId,
      outcome: 'tdr_incomplete',
      missing,
      technician_id: technicianId,
      tech_sms_result: smsRes && smsRes.success ? 'ok' : (smsRes ? 'maybe_failed' : 'no_phone'),
    };
    await xano.markSignalProcessed(signal.id, 'tdr_quality_check_handled', meta);
    log('tdr_quality_check_handled', meta);
    return { success: true, action: 'tdr_incomplete', job_id: jobId, missing };
  }

  // TDR is complete → emit TDR_COMPLETE for warranty_router.
  let completeSignalId = null;
  try {
    const emit = await xano.emitSignal({
      signal_type: 'TDR_COMPLETE',
      signal_strength: 70,
      payload: {
        job_id: jobId,
        vendor,
        warranty_company: job.warranty_company || '',
        claim_number: job.claim_number || '',
        technician_id: technicianId || job.technician_id || null,
        customer_id: ctxData.customer?.id || null,
        appliance_type: job.appliance_type || '',
        source: 'tdr_quality_gate',
        source_signal_id: signal.id,
      },
    });
    completeSignalId = emit && (emit.signal_id || emit.id);
  } catch (err) {
    log('tdr_complete_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    outcome: 'tdr_complete_ready_for_router',
    vendor,
    tdr_complete_signal_id: completeSignalId,
  };
  await xano.markSignalProcessed(signal.id, 'tdr_quality_check_handled', meta);
  log('tdr_quality_check_handled', meta);

  return { success: true, action: 'tdr_complete_ready_for_router', job_id: jobId };
}
