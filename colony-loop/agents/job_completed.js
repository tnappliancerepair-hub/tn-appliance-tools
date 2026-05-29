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

  // ── Chain: SCHEDULER_POST_STOP_CHECKIN (immediate) ──
  // The scheduler ant pings the tech right after they complete a stop:
  // "Good to go? X more left today. Tap to switch anything around."
  // Agent: scheduler_post_stop_checkin.js — gates on tech_id != 1,
  // remaining-jobs > 0, after-hours, and dedup via signal processing.
  try {
    await xano.emitSignal({
      signal_type: 'SCHEDULER_POST_STOP_CHECKIN',
      signal_strength: 45,
      payload: { job_id: jobId, technician_id: job.technician_id || 0, source: 'job_completed' },
    });
  } catch (e) {
    log('scheduler_post_stop_checkin_emit_failed', { job_id: jobId, error: e.message });
  }

  // ── Chain: FOLLOWUP_DUE (24h) ──
  // Fire for EVERY completed job (warranty + self-pay). followup_due.js
  // holds via re-emit until the deadline, then sends the customer the
  // existing send_feedback_sms (1-5 rating + ISSUE keyword). Independent
  // of the warranty digest path below — a non-warranty job still triggers
  // followup. Emit early so a later branch failure can't skip it.
  try {
    const deadlineMs = Date.now() + 24 * 60 * 60 * 1000;
    await xano.emitSignal({
      signal_type: 'FOLLOWUP_DUE',
      signal_strength: 50,
      payload: {
        job_id: jobId,
        deadline_ms: deadlineMs,
        scheduled_for_ms: deadlineMs,
        source: 'job_completed_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('followup_due_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // ── Chain: CUSTOMER_INTELLIGENCE_REQUEST_CUSTOMER_LIFETIME_VALUE ──
  // Auto-refresh LTV score for the customer on every completed job. The
  // customer_intelligence_request_customer_lifetime_value.js agent (CI002)
  // already exists (architect-built) — wiring the producer side here.
  try {
    await xano.emitSignal({
      signal_type: 'CUSTOMER_INTELLIGENCE_REQUEST_CUSTOMER_LIFETIME_VALUE',
      signal_strength: 45,
      payload: {
        job_id: jobId,
        customer_id: payload.customer_id || null,
        trigger_event: 'job_completed',
        source: 'job_completed_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('ltv_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // ── Chain: MAINTENANCE_REMINDER_DUE (6mo post-completion) ──
  try {
    const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;
    const reminderDeadline = Date.now() + sixMonthsMs;
    await xano.emitSignal({
      signal_type: 'MAINTENANCE_REMINDER_DUE',
      signal_strength: 30,
      payload: {
        job_id: jobId,
        customer_id: payload.customer_id || null,
        customer_phone: payload.customer_phone || '',
        first_name: payload.customer_first_name || '',
        appliance_type: payload.appliance_type || '',
        deadline_ms: reminderDeadline,
        scheduled_for_ms: reminderDeadline,
        source: 'job_completed_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('maintenance_reminder_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // ── Chain: SERVICE_AGREEMENT_OFFER (1h post-completion, self-pay) ──
  try {
    const ct = String(payload.customer_type || '').toLowerCase();
    if (ct === 'self_pay' || ct === 'cash' || ct === 'customer_pay') {
      const deadline = Date.now() + 60 * 60 * 1000;
      await xano.emitSignal({
        signal_type: 'SERVICE_AGREEMENT_OFFER',
        signal_strength: 30,
        payload: {
          job_id: jobId,
          customer_id: payload.customer_id || null,
          customer_phone: payload.customer_phone || '',
          first_name: payload.customer_first_name || '',
          deadline_ms: deadline,
          scheduled_for_ms: deadline,
          source: 'job_completed_chain',
          source_signal_id: signal.id,
        },
      });
    }
  } catch (err) {
    log('service_agreement_offer_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // ── Chain: SAME_DAY_SLOT_OFFER (gap-detection, reactive) ──
  try {
    const techId = Number(payload.technician_id || 0);
    if (techId > 0) {
      const nextRes = await fetch(
        `${config.xanoIntakeBase}/get_next_tech_job?tech_id=${techId}&exclude_job_id=${jobId}`
      ).then(r => r.json()).catch(() => null);
      const nextStartMs = nextRes && nextRes.next_job && Number(nextRes.next_job.scheduled_start || 0);
      if (nextStartMs && nextStartMs > Date.now()) {
        const gapMs = nextStartMs - Date.now();
        const gapMinutes = Math.round(gapMs / 60000);
        if (gapMinutes >= 120) {
          await xano.emitSignal({
            signal_type: 'SAME_DAY_SLOT_OFFER',
            signal_strength: 55,
            payload: {
              job_id: jobId,
              technician_id: techId,
              gap_minutes: gapMinutes,
              next_job_id: nextRes.next_job.id,
              next_scheduled_start: nextStartMs,
              source: 'job_completed_chain',
              source_signal_id: signal.id,
            },
          });
        }
      }
    }
  } catch (err) {
    log('same_day_slot_offer_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // ── Chain: STRIPE_PAYMENT_LINK_DUE (immediate, self-pay only) ──
  // For self-pay completions, send the customer a Stripe Checkout link
  // to pay their balance. Skip warranty / cash_tdr — those have other
  // payment flows.
  try {
    const customerType = String(payload.customer_type || '').toLowerCase();
    if (customerType === 'self_pay' || customerType === 'cash' || customerType === 'customer_pay') {
      await xano.emitSignal({
        signal_type: 'STRIPE_PAYMENT_LINK_DUE',
        signal_strength: 65,
        payload: {
          job_id: jobId,
          customer_id: payload.customer_id || null,
          customer_phone: payload.customer_phone || '',
          customer_email: payload.customer_email || '',
          first_name: payload.customer_first_name || '',
          amount_cents: payload.invoice_amount_cents || 0,
          source: 'job_completed_chain',
          source_signal_id: signal.id,
        },
      });
    }
  } catch (err) {
    log('stripe_payment_link_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // ── Chain: EMBED_TDR (immediate, closed-loop intelligence) ──
  // Every completed job's TDR text becomes searchable in the vector
  // store. Once enough rows accumulate, find-similar-jobs + ask-ant
  // return meaningful matches.
  try {
    await xano.emitSignal({
      signal_type: 'EMBED_TDR',
      signal_strength: 25,
      payload: {
        job_id: jobId,
        technician_id: payload.technician_id || null,
        source: 'job_completed_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('embed_tdr_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // ── Chain: GOOGLE_REVIEW_REQUEST (7d) ──
  // 7 days post-completion, ask the customer for a Google review.
  // google_review_request.js holds-and-re-emits until deadline, then
  // dedups per-customer (60-day window) before sending. Fires for both
  // warranty and self-pay — happy customers are happy regardless of
  // who's paying.
  try {
    const reviewDeadlineMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await xano.emitSignal({
      signal_type: 'GOOGLE_REVIEW_REQUEST',
      signal_strength: 35,
      payload: {
        job_id: jobId,
        customer_id: payload.customer_id || null,
        customer_phone: payload.customer_phone || '',
        first_name: payload.customer_first_name || '',
        tech_first: payload.tech_first_name || '',
        deadline_ms: reviewDeadlineMs,
        scheduled_for_ms: reviewDeadlineMs,
        source: 'job_completed_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('google_review_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

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
    const meta = {
      job_id: jobId,
      outcome: 'skipped_not_warranty',
      warranty_company: payload.warranty_company || null,
    };
    await xano.markSignalProcessed(signal.id, 'warranty_submission_handled', meta);
    log('warranty_submission_handled', meta);
    return { success: true, action: 'skipped_not_warranty', job_id: jobId };
  }

  const ctxData = await xano.getWarrantySubmissionContext(jobId);
  if (!ctxData || !ctxData.success || !ctxData.job) {
    log('warranty_submission_handled', { job_id: jobId, outcome: 'context_load_failed' });
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
    const meta = {
      job_id: jobId,
      outcome: 'incomplete_tdr',
      missing,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    };
    await xano.markSignalProcessed(signal.id, 'warranty_submission_handled', meta);
    log('warranty_submission_handled', meta);
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

  const finalMeta = {
    job_id: jobId,
    outcome: 'danielle_digest_sent',
    vendor,
    claim_number: job.claim_number,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'warranty_submission_handled', finalMeta);
  log('warranty_submission_handled', finalMeta);

  // ── Chain: TDR_QUALITY_CHECK ──
  // Hand off to tdr_quality_gate.js so it can SMS the assigned tech with
  // any missing fields (separate channel from Danielle's digest) AND emit
  // TDR_COMPLETE for the warranty_router agent (BUILD 3) to auto-submit
  // the claim. Independent emit so a failure here doesn't back-propagate
  // into the Danielle digest path.
  try {
    await xano.emitSignal({
      signal_type: 'TDR_QUALITY_CHECK',
      signal_strength: 65,
      payload: {
        job_id: jobId,
        technician_id: job.technician_id || null,
        customer_id: customer?.id || null,
        warranty_company: job.warranty_company || '',
        vendor,
        claim_number: job.claim_number || '',
        appliance_type: job.appliance_type || '',
        customer_first_name: customer?.first_name || '',
        source: 'job_completed_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('tdr_quality_check_chain_failed', { job_id: jobId, error: String(err.message || err) });
  }

  return {
    success: true,
    action: 'danielle_digest_sent',
    job_id: jobId,
    vendor,
    claim_number: job.claim_number,
  };
}
