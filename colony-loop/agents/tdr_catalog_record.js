// Handles TDR_CATALOG_RECORD signals (emitted by tdr_submitted.js as a
// chain step alongside the supplier fanout).
//
// Persists a structured catalog entry to event_log for every completed
// TDR. Over time this builds proprietary failure-mode → part-number
// intelligence keyed by (appliance_type, brand, model_number). Query
// via get_common_failures_GET to surface "for this brand+model, the
// top 3 failure modes historically are X, Y, Z with parts A, B, C".
//
// No SMS — pure data accumulation. The query endpoint surfaces the
// aggregate to upstream consumers (Teddy Tool, diagnose_*, parts_lookup_*).
export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const applianceType = String(payload.appliance_type || '').trim().toLowerCase();
  const brand = String(payload.brand || '').trim().toLowerCase();
  const model = String(payload.model_number || '').trim();
  const failedComponent = String(payload.failed_component || '').trim();
  const verifiedPart = String(payload.verified_part_number || '').trim();

  // Skip when the entry has nothing useful to learn from (no component
  // identified, no model number). These don't strengthen the catalog.
  if (!failedComponent || !applianceType) {
    const meta = {
      job_id: jobId,
      outcome: 'skipped_insufficient_data',
      has_component: !!failedComponent,
      has_appliance: !!applianceType,
    };
    await xano.markSignalProcessed(signal.id, 'tdr_catalog_record_handled', meta);
    log('tdr_catalog_record_handled', meta);
    return { success: true, action: 'skipped_insufficient_data' };
  }

  try {
    await xano.recordEventLog('tdr_catalog_entry', {
      job_id: jobId,
      tdr_id: payload.tdr_id || null,
      appliance_type: applianceType,
      brand,
      model_number: model,
      failed_component: failedComponent.toLowerCase(),
      failed_component_raw: failedComponent,
      failure_cause: String(payload.failure_cause || '').trim().toLowerCase(),
      verified_part_number: verifiedPart,
      diagnosis_snippet: String(payload.diagnosis || '').trim().slice(0, 200),
      catalog_version: 1,
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('tdr_catalog_persist_failed', { job_id: jobId, error: String(err.message || err) });
    const meta = { job_id: jobId, outcome: 'persist_failed' };
    await xano.markSignalProcessed(signal.id, 'tdr_catalog_record_handled', meta);
    return { success: false, action: 'persist_failed' };
  }

  const meta = {
    job_id: jobId,
    outcome: 'cataloged',
    appliance_type: applianceType,
    brand,
    has_model: !!model,
    has_part_number: !!verifiedPart,
  };
  await xano.markSignalProcessed(signal.id, 'tdr_catalog_record_handled', meta);
  log('tdr_catalog_record_handled', meta);

  return { success: true, action: 'cataloged', job_id: jobId };
}
