// Handles TECH_ON_WAY signals (emitted by tech_on_the_way_POST.xs when a
// tech taps the 🚗 On My Way button). The customer-facing SMS already
// fired server-side via that endpoint — this agent's job is to schedule
// an arrival check at ETA + 30 min by emitting TECH_ARRIVAL_CHECK with
// scheduled_for_ms in the payload.
//
// Dedup: TECH_ON_WAY may be emitted by multiple producer paths; we only
// want one check per (job_id, technician_id) pair. Tracked via event_log
// action="tech_arrival_check_scheduled".
const GRACE_AFTER_ETA_MS = 30 * 60 * 1000; // 30 min after ETA

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const technicianId = Number(payload.technician_id || 0);
  const etaTimestampMs = Number(payload.eta_timestamp_ms || 0);

  if (!jobId || !technicianId) {
    await xano.markSignalProcessed(signal.id, 'tech_on_way_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  if (!etaTimestampMs) {
    // No ETA → can't schedule a check. Just acknowledge.
    const meta = { job_id: jobId, technician_id: technicianId, outcome: 'skipped_no_eta' };
    await xano.markSignalProcessed(signal.id, 'tech_on_way_handled', meta);
    log('tech_on_way_handled', meta);
    return { success: true, action: 'skipped_no_eta', job_id: jobId };
  }

  const deadlineMs = etaTimestampMs + GRACE_AFTER_ETA_MS;

  // Schedule the arrival check via hold-and-re-emit.
  let checkSignalId = null;
  try {
    const emit = await xano.emitSignal({
      signal_type: 'TECH_ARRIVAL_CHECK',
      signal_strength: 60,
      payload: {
        job_id: jobId,
        technician_id: technicianId,
        customer_id: payload.customer_id || null,
        customer_phone: payload.customer_phone || '',
        eta_timestamp_ms: etaTimestampMs,
        deadline_ms: deadlineMs,
        scheduled_for_ms: deadlineMs,
        source: 'tech_on_way',
        source_signal_id: signal.id,
      },
    });
    checkSignalId = emit && (emit.signal_id || emit.id);
  } catch (err) {
    log('tech_arrival_check_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // Audit the schedule so we can dedup if TECH_ON_WAY re-fires for the
  // same job (rare but possible if operator manually re-injects).
  try {
    await xano.recordEventLog('tech_arrival_check_scheduled', {
      job_id: jobId,
      technician_id: technicianId,
      eta_timestamp_ms: etaTimestampMs,
      deadline_ms: deadlineMs,
      check_signal_id: checkSignalId,
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('tech_arrival_check_audit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    technician_id: technicianId,
    outcome: 'arrival_check_scheduled',
    deadline_ms: deadlineMs,
    check_signal_id: checkSignalId,
  };
  await xano.markSignalProcessed(signal.id, 'tech_on_way_handled', meta);
  log('tech_on_way_handled', meta);

  return { success: true, action: 'arrival_check_scheduled', job_id: jobId, deadline_ms: deadlineMs };
}
