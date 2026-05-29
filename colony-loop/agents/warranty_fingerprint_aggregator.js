// WARRANTY-COMPANY FINGERPRINT AGGREGATOR
//
// Daily 4:30am CT — analyzes the past 60 days of warranty_claim_action
// + warranty_correction events PER VENDOR and writes a behavioral
// fingerprint event (action="warranty_vendor_fingerprint") for each.
//
// Tech Assist reads the fingerprint at session start (via
// get_warranty_fingerprint) and pre-asks for the fields THIS vendor
// is most likely to reject without — in the order most likely to get
// approved on the first try.
//
// Fingerprint dimensions per vendor:
//   - claims_count (60d)
//   - mean_days_to_approval (NULL until approval-result tracking lands)
//   - most_common_correction_fields (from warranty_correction events)
//   - rejection_rate_estimate (escalated + flagged share)
//   - top_capability_gaps (gap_description aggregations)
//   - submission_streak (consecutive successful clears)
//
// Why fingerprint daily not realtime: the patterns are slow-moving;
// recomputing nightly is cheaper + lets the digest reflect the past
// 60d window consistently.

import { listRecentEventLog, recordEvent } from '../xano.js';

const FP_WINDOW_DAYS = 60;
const VENDOR_KEYS = ['AHS', 'ServicePower', 'Frontdoor', 'Allstate', 'SquareTrade', 'ChoiceHomeWarranty'];

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  // Pull recent claim actions + corrections in one batch each
  const [claims, corrections] = await Promise.all([
    listRecentEventLog({ action: 'warranty_claim_action_persisted', days_back: FP_WINDOW_DAYS, limit: 2000 }).catch(() => []),
    listRecentEventLog({ action: 'warranty_correction', days_back: FP_WINDOW_DAYS, limit: 2000 }).catch(() => []),
  ]);

  if ((!claims || claims.length === 0) && (!corrections || corrections.length === 0)) {
    await xano.markSignalProcessed(signal.id, 'warranty_fingerprint_aggregator_handled', { reason: 'no_data' });
    return { success: true, action: 'no_data' };
  }

  // Bucket by vendor. Vendor name lives in metadata.specialty_display
  // (claims) or metadata.warranty_company (corrections).
  const fingerprints = new Map();
  for (const v of VENDOR_KEYS) {
    fingerprints.set(v, {
      vendor: v,
      claims_count: 0,
      clear_count: 0,
      flagged_count: 0,
      escalated_count: 0,
      correction_count: 0,
      correction_fields: new Map(),
      window_days: FP_WINDOW_DAYS,
      computed_at_ms: Date.now(),
    });
  }

  for (const row of claims) {
    let meta;
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { continue; }
    if (!meta) continue;
    const v = vendorMatch(meta.vendor || meta.specialty_display || meta.warranty_company);
    if (!v) continue;
    const fp = fingerprints.get(v);
    fp.claims_count += 1;
    const outcome = String(meta.outcome || '').toLowerCase();
    if (outcome === 'ready' || outcome === 'clear') fp.clear_count += 1;
    else if (outcome === 'flags_present' || outcome.includes('flag')) fp.flagged_count += 1;
    else if (outcome === 'escalated' || outcome.includes('escalat')) fp.escalated_count += 1;
  }

  for (const row of corrections) {
    let meta;
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { continue; }
    if (!meta) continue;
    const v = vendorMatch(meta.warranty_company || meta.vendor);
    if (!v) continue;
    const fp = fingerprints.get(v);
    fp.correction_count += 1;
    const fields = Array.isArray(meta.missing_fields) ? meta.missing_fields : (meta.corrected_field ? [meta.corrected_field] : []);
    for (const f of fields) {
      const key = String(f).toLowerCase().replace(/\s+/g, '_');
      fp.correction_fields.set(key, (fp.correction_fields.get(key) || 0) + 1);
    }
  }

  let written = 0;
  for (const fp of fingerprints.values()) {
    if (fp.claims_count === 0 && fp.correction_count === 0) continue;

    const topFields = Array.from(fp.correction_fields.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([field, count]) => ({ field, count }));

    const rejectionRate = fp.claims_count
      ? Math.round(((fp.flagged_count + fp.escalated_count) / fp.claims_count) * 100)
      : 0;
    const clearRate = fp.claims_count ? Math.round((fp.clear_count / fp.claims_count) * 100) : 0;

    try {
      await recordEvent('warranty_vendor_fingerprint', {
        vendor: fp.vendor,
        window_days: FP_WINDOW_DAYS,
        claims_count: fp.claims_count,
        clear_count: fp.clear_count,
        flagged_count: fp.flagged_count,
        escalated_count: fp.escalated_count,
        clear_rate_pct: clearRate,
        rejection_rate_pct: rejectionRate,
        correction_count: fp.correction_count,
        top_correction_fields: topFields,
        computed_at_ms: fp.computed_at_ms,
      });
      written += 1;
    } catch (_) {}
  }

  await xano.markSignalProcessed(signal.id, 'warranty_fingerprint_aggregator_handled', {
    vendors_written: written,
    total_claims_in_window: claims.length,
    total_corrections_in_window: corrections.length,
  });
  log('warranty_fingerprint_aggregator_handled', { vendors: written });
  return { success: true, action: 'computed', count: written };
}

function vendorMatch(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('ahs') || s.includes('american home')) return 'AHS';
  if (s.includes('servicepower') || s.includes('service power')) return 'ServicePower';
  if (s.includes('frontdoor') || s.includes('front door')) return 'Frontdoor';
  if (s.includes('allstate')) return 'Allstate';
  if (s.includes('squaretrade')) return 'SquareTrade';
  if (s.includes('choice') && s.includes('warranty')) return 'ChoiceHomeWarranty';
  return null;
}
