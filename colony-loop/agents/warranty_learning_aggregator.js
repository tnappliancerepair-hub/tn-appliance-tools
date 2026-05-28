// WARRANTY_LEARNING_AGGREGATOR
//
// Fires once daily (signal type WARRANTY_LEARNING_AGGREGATE emitted by
// tick.js at 5am CT). Reads recent warranty_correction event_log rows
// (last 14 days), groups by (warranty_company, item_key), and when a
// pattern crosses threshold writes a warranty_requirement_override row.
//
// Pattern thresholds:
//   - 3+ "missing_field" / "missing_photo" corrections for same item
//     within 14 days → promote item to required for that vendor
//   - 3+ "wrong_value" corrections → flag a wording-update proposal
//   - 1 "rejected_by_portal" correction → immediate override (single
//     portal rejection is high-signal)
//
// Outputs go to event_log with action="warranty_requirement_override".
// The Netlify get-warranty-requirements function reads these via
// list_warranty_requirement_overrides and merges with the base JSON
// before sending to the brain.
//
// At-most-once-per-day-per-(vendor,item) dedup via event_log lookup.

const CORRECTION_WINDOW_DAYS = 14;
const THRESHOLD_PATTERN = 3;
const THRESHOLD_REJECTION = 1;

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  // Dedup: have we already run today?
  const todayMs = Date.now();
  const todayKey = new Date(todayMs).toISOString().slice(0, 10);
  const fired = await xano.checkEventLogFiredToday('warranty_learning_aggregator_fired', todayKey);
  if (fired) {
    await xano.markSignalProcessed(signal.id, 'warranty_learning_aggregator_skipped', {
      reason: 'already_fired_today',
      day: todayKey,
    });
    return { success: true, action: 'skipped_already_fired' };
  }

  // Pull recent correction events.
  const corrections = await xano.listRecentEventLog({
    action: 'warranty_correction',
    days_back: CORRECTION_WINDOW_DAYS,
    limit: 1000,
  });

  // Group: { "vendor::item_key" : [corrections...] }
  const groups = {};
  for (const row of corrections || []) {
    const meta = safeParseJson(row.metadata);
    if (!meta || !meta.warranty_company || !meta.item_key) continue;
    const key = `${meta.warranty_company}::${meta.item_key}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ row, meta });
  }

  // Pull active overrides so we don't propose the same thing twice.
  const existingOverrides = await xano.listWarrantyRequirementOverrides({ days_back: 60 });
  const existingKeys = new Set();
  for (const ov of existingOverrides || []) {
    const m = safeParseJson(ov.metadata_raw || ov.metadata);
    if (m && m.warranty_company && m.item_key) {
      existingKeys.add(`${m.warranty_company}::${m.item_key}::${m.status || 'active'}`);
    }
  }

  let proposed = 0;
  const proposals = [];

  for (const [groupKey, entries] of Object.entries(groups)) {
    const [vendor, itemKey] = groupKey.split('::');
    const correctionTypes = entries.map((e) => e.meta.correction_type);
    const hasRejection = correctionTypes.some((t) => t === 'rejected_by_portal');
    const missingCount = correctionTypes.filter((t) => t === 'missing_field' || t === 'missing_photo' || t === 'extra_required').length;
    const wrongValueCount = correctionTypes.filter((t) => t === 'wrong_value').length;

    let action = null;
    let basis = '';
    if (hasRejection && entries.length >= THRESHOLD_REJECTION) {
      action = 'add_required';
      basis = `${correctionTypes.filter((t) => t === 'rejected_by_portal').length} portal rejection(s)`;
    } else if (missingCount >= THRESHOLD_PATTERN) {
      action = 'add_required';
      basis = `${missingCount} missing-item corrections`;
    } else if (wrongValueCount >= THRESHOLD_PATTERN) {
      action = 'update_prompt';
      basis = `${wrongValueCount} wrong-value corrections`;
    } else {
      continue;  // not enough signal yet
    }

    if (existingKeys.has(`${vendor}::${itemKey}::active`)) continue;

    const sample = entries[0].meta;
    const overridePayload = {
      warranty_company: vendor,
      item_key: itemKey,
      item_type: sample.item_type || 'field',
      field_or_subject: sample.field_or_subject || itemKey,
      action,
      required: action === 'add_required',
      prompt: derivePromptFromCorrections(itemKey, entries),
      based_on_correction_count: entries.length,
      basis,
      status: 'active',
      proposed_at_ms: todayMs,
      source_correction_ids: entries.map((e) => e.row.id),
    };

    try {
      await xano.recordEvent('warranty_requirement_override', overridePayload);
      proposed += 1;
      proposals.push({ vendor, itemKey, action, basis });
    } catch (err) {
      log('warranty_override_write_failed', { vendor, itemKey, err: String(err) });
    }
  }

  // Mark daily fire so we don't re-run.
  await xano.recordEvent('warranty_learning_aggregator_fired', {
    day: todayKey,
    corrections_scanned: corrections.length,
    overrides_proposed: proposed,
    proposals,
  });

  await xano.markSignalProcessed(signal.id, 'warranty_learning_aggregator_done', {
    corrections_scanned: corrections.length,
    overrides_proposed: proposed,
    proposals,
  });

  log('warranty_learning_aggregator_done', {
    corrections: corrections.length,
    proposed,
    proposals,
  });
  return { success: true, action: 'aggregated', corrections: corrections.length, proposed };
}

function safeParseJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

// Derive a brain-friendly prompt from the corrections. Prefer the
// first non-empty notes field; otherwise synthesize a generic one.
function derivePromptFromCorrections(itemKey, entries) {
  for (const e of entries) {
    const n = (e.meta.notes || '').trim();
    if (n) return n;
  }
  return `Capture the ${itemKey.replace(/_/g, ' ')} — required by this vendor.`;
}
