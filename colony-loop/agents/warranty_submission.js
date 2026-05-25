import { config } from '../config.js';

const HANDLED_VENDORS = new Set(['ahs', 'servicepower', 'squaretrade', 'frontdoor']);

const REQUIRED_TDR_FIELDS = [
  'diagnosis',
  'failed_component',
  'failure_cause',
  'diagnostic_test_performed',
  'labor_time_hours',
  'repair_completed',
];

function vendorKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

function fmtMoneyCents(c) {
  const n = Number(c || 0);
  return '$' + (n / 100).toFixed(2);
}

function fmtPartsUsed(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return '(none)';
  return parts
    .map((p) => {
      const name = p.part_name || p.name || p.description || 'unknown';
      const pn = p.part_number || p.pn || '';
      const cost =
        p.cost_cents != null
          ? fmtMoneyCents(p.cost_cents)
          : p.cost != null
          ? '$' + Number(p.cost).toFixed(2)
          : '';
      return [pn, name, cost].filter(Boolean).join(' ');
    })
    .join(', ');
}

function checkCompleteness(job, tdr, vendor) {
  if (!tdr) return ['tdr_missing'];
  const missing = [];
  for (const f of REQUIRED_TDR_FIELDS) {
    const v = tdr[f];
    if (v == null || v === '' || (f === 'labor_time_hours' && Number(v) <= 0)) {
      missing.push('tdr.' + f);
    }
  }
  if (!job.claim_number) missing.push('job.claim_number');
  if (vendor === 'ahs' && !job.warranty_vendor_id) missing.push('job.warranty_vendor_id');
  if (vendor === 'servicepower' && !job.dispatch_source_id) missing.push('job.dispatch_source_id');
  return missing;
}

function bareDomain() {
  return config.publicSiteBase.replace(/^https?:\/\//, '');
}

function composeDigest({ job, customer, tdr, tdr_failures, vendor, jobLabel }) {
  const custName =
    [(customer?.first_name || '').trim(), (customer?.last_name || '').trim()]
      .filter(Boolean)
      .join(' ') || 'unknown';
  const appliance = (job.appliance_type || '').toLowerCase() || 'appliance';
  const vendorLabel = job.warranty_company || vendor.toUpperCase();
  const lines = [
    '[ant] warranty submission ready',
    `Job #${jobLabel} - ${custName}, ${appliance}`,
    `${vendorLabel} claim #${job.claim_number}`,
  ];
  if (job.brand || job.model_number) {
    lines.push(`${job.brand || ''} ${job.model_number || ''}`.trim());
  }
  lines.push(`Diagnosis: ${tdr.diagnosis}`);
  lines.push(`Failed: ${tdr.failed_component} (${tdr.failure_cause || 'cause TBD'})`);
  if (tdr.diagnostic_test_performed) {
    lines.push(`Test: ${tdr.diagnostic_test_performed}`);
  }
  lines.push(`Parts: ${fmtPartsUsed(tdr.parts_used)}`);
  lines.push(
    `Labor: ${Number(tdr.labor_time_hours).toFixed(1)}h  Repair: ${tdr.repair_completed}`,
  );
  if (tdr.technician_first_name) {
    lines.push(`Tech: ${tdr.technician_first_name} ${tdr.technician_last_name || ''}`.trim());
  }
  if (Array.isArray(tdr_failures) && tdr_failures.length > 1) {
    lines.push(`(${tdr_failures.length} failure rows on TDR)`);
  }
  lines.push(`Review: ${bareDomain()}/warranty-review.html?job_id=${job.id}`);
  return lines.join('\n');
}

function composeIncompleteDigest({ job, customer, missing, jobLabel }) {
  const custName =
    [(customer?.first_name || '').trim(), (customer?.last_name || '').trim()]
      .filter(Boolean)
      .join(' ') || 'unknown';
  const appliance = (job.appliance_type || '').toLowerCase() || 'appliance';
  return [
    '[ant] warranty submission BLOCKED',
    `Job #${jobLabel} - ${custName}, ${appliance}`,
    `${job.warranty_company || 'Warranty'} claim #${job.claim_number || '(missing)'}`,
    `Cannot submit - missing:`,
    `  ${missing.join(', ')}`,
    `Tech needs to complete TDR.`,
    `Teddy Tool: ${bareDomain()}/teddy-tdr-tool.html?job_id=${job.id}`,
  ].join('\n');
}

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) throw new Error('payload.job_id required');

  const handled = await xano.getWarrantySubmissionHandled(jobId);
  if (handled && handled.handled) {
    return {
      success: true,
      action: 'skipped_duplicate',
      job_id: jobId,
      last_handled_at: handled.last_handled_at,
    };
  }

  const vendor = vendorKey(payload.warranty_company);
  if (!vendor || !HANDLED_VENDORS.has(vendor)) {
    log('warranty_submission_handled', {
      job_id: jobId,
      action: 'skipped_not_warranty',
      warranty_company: payload.warranty_company || null,
    });
    return { success: true, action: 'skipped_not_warranty', job_id: jobId };
  }

  const ctxData = await xano.getWarrantySubmissionContext(jobId);
  if (!ctxData || !ctxData.success || !ctxData.job) {
    log('warranty_submission_handled', { job_id: jobId, action: 'context_load_failed' });
    return { success: false, action: 'context_load_failed', job_id: jobId };
  }
  const { job, customer, tdr, tdr_failures } = ctxData;
  const jobLabel = job.job_number || String(job.id);

  const missing = checkCompleteness(job, tdr, vendor);
  if (missing.length > 0) {
    const body = composeIncompleteDigest({ job, customer, missing, jobLabel });
    const smsRes = await sms.toDanielle(body, {
      action: 'warranty_incomplete_alert',
      job_id: jobId,
      source_signal_id: signal.id,
      missing,
    });
    log('warranty_submission_handled', {
      job_id: jobId,
      action: 'incomplete_tdr',
      missing,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
    return { success: true, action: 'incomplete_tdr', job_id: jobId, missing };
  }

  const body = composeDigest({ job, customer, tdr, tdr_failures, vendor, jobLabel });
  const smsRes = await sms.toDanielle(body, {
    action: 'warranty_submission_digest',
    job_id: jobId,
    source_signal_id: signal.id,
    vendor,
    claim_number: job.claim_number,
  });

  log('warranty_submission_handled', {
    job_id: jobId,
    action: 'danielle_digest_sent',
    vendor,
    claim_number: job.claim_number,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  });

  return {
    success: true,
    action: 'danielle_digest_sent',
    job_id: jobId,
    vendor,
    claim_number: job.claim_number,
  };
}
