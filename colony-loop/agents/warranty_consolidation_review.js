// WARRANTY_CONSOLIDATION_REVIEW
//
// Fires weekly on Sunday at 4pm CT (4-6pm grace window emitted by
// tick.js). Reads all active warranty_requirement_override rows
// written by the aggregator over the past week and SMSes Teddy a
// digest of what's been learned, with a one-tap link to the
// approval UI (/warranty-learning.html).
//
// "Approval" doesn't mean the overrides aren't live — they're
// already merged into get-warranty-requirements at request time.
// It means Teddy reviews them and decides whether to roll into the
// JSON baseline (consolidation) or revert (mark removed).
//
// Idempotent via check_event_log_fired_today on the SUNDAY day_key.

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  const todayMs = Date.now();
  const todayKey = new Date(todayMs).toISOString().slice(0, 10);
  const fired = await xano.checkEventLogFiredToday('warranty_consolidation_review_fired', todayKey);
  if (fired) {
    await xano.markSignalProcessed(signal.id, 'warranty_consolidation_review_skipped', {
      reason: 'already_fired_today',
      day: todayKey,
    });
    return { success: true, action: 'skipped_already_fired' };
  }

  const overrides = await xano.listWarrantyRequirementOverrides({ days_back: 14 });

  // Filter to overrides created in the LAST 7 days that are still active.
  const sevenDaysMs = 7 * 86400000;
  const recent = [];
  for (const ov of overrides || []) {
    if (!ov.created_at || (todayMs - Number(ov.created_at)) > sevenDaysMs) continue;
    let meta;
    try { meta = JSON.parse(ov.metadata_raw || ov.metadata); }
    catch (_) { continue; }
    if (!meta || meta.status !== 'active') continue;
    recent.push({ ...meta, _id: ov.event_log_id, _created_at: ov.created_at });
  }

  if (recent.length === 0) {
    await xano.recordEvent('warranty_consolidation_review_fired', {
      day: todayKey,
      proposals_in_window: 0,
      sms_sent: false,
      reason: 'nothing_new_to_review',
    });
    await xano.markSignalProcessed(signal.id, 'warranty_consolidation_review_done', {
      proposals: 0,
      sms_sent: false,
    });
    log('warranty_consolidation_review_done', { proposals: 0 });
    return { success: true, action: 'nothing_to_review' };
  }

  // Group by vendor for the digest.
  const byVendor = {};
  for (const m of recent) {
    if (!byVendor[m.warranty_company]) byVendor[m.warranty_company] = [];
    byVendor[m.warranty_company].push(m);
  }

  const lines = [`[ant] warranty learning weekly digest — ${recent.length} new override(s) across ${Object.keys(byVendor).length} vendor(s):`];
  for (const [vendor, items] of Object.entries(byVendor)) {
    lines.push(`• ${vendor.toUpperCase()}: ${items.length} change(s)`);
    for (const it of items.slice(0, 3)) {
      const verb = it.action === 'add_required' ? 'now requires' : it.action === 'update_prompt' ? 'reworded prompt for' : it.action;
      lines.push(`   - ${verb} ${it.item_key} (${it.basis || 'pattern detected'})`);
    }
    if (items.length > 3) lines.push(`   - +${items.length - 3} more`);
  }
  lines.push('');
  lines.push('Review + roll into JSON baseline: https://tnapplianceexchange.net/warranty-learning.html');

  const body = lines.join('\n');

  let smsResult;
  try {
    smsResult = await sms.toOwner(body, { call_site: 'warranty_consolidation_review' });
  } catch (e) {
    smsResult = { ok: false, error: String(e) };
  }

  await xano.recordEvent('warranty_consolidation_review_fired', {
    day: todayKey,
    proposals_in_window: recent.length,
    vendors: Object.keys(byVendor),
    sms_sent: !!(smsResult && smsResult.ok),
  });

  await xano.markSignalProcessed(signal.id, 'warranty_consolidation_review_done', {
    proposals: recent.length,
    vendors: Object.keys(byVendor),
    sms_result: smsResult,
  });

  log('warranty_consolidation_review_sent', { proposals: recent.length });
  return { success: true, action: 'digest_sent', proposals: recent.length };
}
