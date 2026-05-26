// Handles TDR_COMPLETE signals (emitted by tdr_quality_gate.js when a
// warranty job's TDR passes the completeness check). Routes to the right
// vendor-specific submission agent by emitting WARRANTY_CLAIM_REQUEST_<VENDOR>.
//
// Currently supported vendor agents:
//   AHS         → emit WARRANTY_CLAIM_REQUEST_AHS    → warranty_ahs_claims.js
//   SquareTrade → emit WARRANTY_CLAIM_REQUEST_SQUARETRADE → warranty_squaretrade_claims (TODO)
//   Frontdoor   → emit WARRANTY_CLAIM_REQUEST_FRONTDOOR   → warranty_frontdoor_claims.js
//
// Unknown vendor → SMS Danielle (the job_completed.js Danielle digest
// already fired upstream, so this is a noop-skip with reason logged).
//
// This is the wire that activates the dormant warranty_* agents the
// architect built.
import { toDanielle } from '../sms.js';

// Signal types must match architect-built agent filenames (dispatch routes
// by lowercased signal_type). The architect named agents by their display
// name → slug (e.g. "AHS Claims" → ahs_claims), so the actual signal types
// carry the _CLAIMS suffix.
const VENDOR_TO_SIGNAL = {
  ahs: 'WARRANTY_CLAIM_REQUEST_AHS_CLAIMS',
  frontdoor: 'WARRANTY_CLAIM_REQUEST_FRONTDOOR_CLAIMS',
  // squaretrade — no agent built (ServicePower portal owns it)
  // servicepower — handled by vendor portal directly
};

function vendorKey(s) {
  return String(s || '').toLowerCase().replace(/[\s_-]/g, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'warranty_router_handled', {
      outcome: 'skipped_missing_job_id',
    });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  const vendor = vendorKey(payload.vendor || payload.warranty_company);
  const targetSignal = VENDOR_TO_SIGNAL[vendor];

  if (!targetSignal) {
    // Vendor not in our auto-submit set — leave the claim to Danielle.
    // The job_completed.js Danielle digest already fired upstream with
    // the full TDR data, so we just log + skip silently here.
    const meta = {
      job_id: jobId,
      outcome: 'skipped_no_auto_submit_for_vendor',
      vendor,
    };
    await xano.markSignalProcessed(signal.id, 'warranty_router_handled', meta);
    log('warranty_router_handled', meta);
    return { success: true, action: 'skipped_no_auto_submit_for_vendor', job_id: jobId, vendor };
  }

  // Emit the vendor-specific submission signal.
  let routedSignalId = null;
  try {
    const emit = await xano.emitSignal({
      signal_type: targetSignal,
      signal_strength: 80,
      payload: {
        job_id: jobId,
        vendor,
        warranty_company: payload.warranty_company || '',
        claim_number: payload.claim_number || '',
        technician_id: payload.technician_id || null,
        customer_id: payload.customer_id || null,
        appliance_type: payload.appliance_type || '',
        source: 'warranty_router',
        source_signal_id: signal.id,
      },
    });
    routedSignalId = emit && (emit.signal_id || emit.id);
  } catch (err) {
    log('warranty_router_emit_failed', { job_id: jobId, vendor, error: String(err.message || err) });
    // Fallback: SMS Danielle the routing failure so she can submit manually.
    try {
      await toDanielle(
        `[ant] warranty router could not auto-route job #${jobId} (${payload.warranty_company || vendor}). Submit manually.`,
        { action: 'warranty_router_emit_failed', job_id: jobId, vendor }
      );
    } catch (_) { /* best effort */ }
  }

  const meta = {
    job_id: jobId,
    outcome: 'routed_to_vendor_agent',
    vendor,
    target_signal: targetSignal,
    routed_signal_id: routedSignalId,
  };
  await xano.markSignalProcessed(signal.id, 'warranty_router_handled', meta);
  log('warranty_router_handled', meta);

  return { success: true, action: 'routed_to_vendor_agent', job_id: jobId, vendor };
}
