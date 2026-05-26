// Handles TDR_SUBMITTED signals (emitted by create_tdr_POST.xs after a
// successful TDR insert). Fans out PARTS_LOOKUP_<SUPPLIER>_PRICING
// signals to the dormant parts-pricing agents so Teddy gets real parts
// pricing back instead of relying on the Sears Parts Direct stopgap.
//
// Wired suppliers (Claude-simulated until Marcone + Triple S APIs land):
//   - parts_marcone_pricing.js     (listens on PARTS_LOOKUP_MARCONE_PRICING)
//   - parts_repairclinic_pricing.js (listens on PARTS_LOOKUP_REPAIRCLINIC_PRICING)
//   - parts_partselect_pricing.js   (listens on PARTS_LOOKUP_PARTSELECT_PRICING)
//
// Skips with reason "no_failed_component" when there's nothing to price.
// Each supplier returns a PARTS_INTELLIGENCE signal; a future
// parts_consolidator agent can join them into a single decision row.
const SUPPLIER_SIGNALS = [
  'PARTS_LOOKUP_MARCONE_PRICING',
  'PARTS_LOOKUP_REPAIRCLINIC_PRICING',
  'PARTS_LOOKUP_PARTSELECT_PRICING',
];

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const tdrId = Number(payload.tdr_id);
  if (!jobId || !tdrId) {
    await xano.markSignalProcessed(signal.id, 'tdr_submitted_handled', {
      outcome: 'skipped_missing_ids',
    });
    return { success: false, action: 'skipped_missing_ids' };
  }

  const failedComponent = String(payload.failed_component || '').trim();
  const verifiedPart = String(payload.verified_part_number || '').trim();
  if (!failedComponent && !verifiedPart) {
    const meta = {
      job_id: jobId,
      tdr_id: tdrId,
      outcome: 'skipped_no_failed_component',
    };
    await xano.markSignalProcessed(signal.id, 'tdr_submitted_handled', meta);
    log('tdr_submitted_handled', meta);
    return { success: true, action: 'skipped_no_failed_component', job_id: jobId };
  }

  // Fan out to suppliers.
  const emitted = [];
  for (const sigType of SUPPLIER_SIGNALS) {
    try {
      const emit = await xano.emitSignal({
        signal_type: sigType,
        signal_strength: 55,
        payload: {
          job_id: jobId,
          tdr_id: tdrId,
          brand: payload.brand || '',
          appliance_type: payload.appliance_type || '',
          model_number: payload.model_number || '',
          failed_component: failedComponent,
          verified_part_number: verifiedPart,
          symptom: payload.failed_component || '',
          source: 'tdr_submitted_router',
          source_signal_id: signal.id,
        },
      });
      emitted.push({ signal_type: sigType, signal_id: emit && (emit.signal_id || emit.id) });
    } catch (err) {
      log('parts_lookup_emit_failed', {
        signal_type: sigType,
        job_id: jobId,
        error: String(err.message || err),
      });
    }
  }

  // Catalog persistence — every TDR submission feeds the proprietary
  // failure-mode → part-number database. Decoupled from the supplier
  // fanout so the catalog accumulates even when no supplier responds.
  try {
    await xano.emitSignal({
      signal_type: 'TDR_CATALOG_RECORD',
      signal_strength: 40,
      payload: {
        job_id: jobId,
        tdr_id: tdrId,
        appliance_type: String(payload.appliance_type || '').toLowerCase(),
        brand: String(payload.brand || '').toLowerCase(),
        model_number: String(payload.model_number || '').trim(),
        failed_component: failedComponent,
        failure_cause: String(payload.failure_cause || '').trim(),
        verified_part_number: verifiedPart,
        diagnosis: String(payload.diagnosis || '').trim(),
        source: 'tdr_submitted_chain',
        source_signal_id: signal.id,
      },
    });
  } catch (err) {
    log('tdr_catalog_emit_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    tdr_id: tdrId,
    outcome: 'parts_lookup_fanout',
    suppliers_emitted: emitted.length,
    emitted,
  };
  await xano.markSignalProcessed(signal.id, 'tdr_submitted_handled', meta);
  log('tdr_submitted_handled', meta);

  return { success: true, action: 'parts_lookup_fanout', job_id: jobId, suppliers_emitted: emitted.length };
}
