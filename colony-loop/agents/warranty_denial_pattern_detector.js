// WARRANTY DENIAL PATTERN DETECTOR
//
// Daily 6pm CT — scans last 14 days of warranty outcomes per vendor.
// When a vendor's denial-or-escalation rate is >40% over 5+ claims,
// alerts Teddy + writes a vendor_denial_pattern observation.
//
// The signal isn't a one-off denied claim (those happen) — it's
// PATTERN. "AHS rejected 4 of last 7 claims" is a systemic issue
// (their criteria changed? our intake is missing something?) and
// worth surfacing for Danielle to investigate.
//
// Reads from claude_call_outcome rows (outcome_type='warranty_claim_
// result', value in {good/neutral/bad}) which the outcome linker
// writes when WARRANTY_CLAIM_ACTION fires.

import { listRecentEventLog, recordEvent } from '../xano.js';

const DENIAL_RATE_THRESHOLD = 0.4;
const MIN_CLAIMS = 5;
const WINDOW_DAYS = 14;
const VENDOR_NORMALIZER = (raw) => {
  const s = String(raw || '').toLowerCase();
  if (s.includes('ahs') || s.includes('american home')) return 'AHS';
  if (s.includes('servicepower') || s.includes('service power')) return 'ServicePower';
  if (s.includes('frontdoor') || s.includes('front door')) return 'Frontdoor';
  if (s.includes('allstate')) return 'Allstate';
  if (s.includes('squaretrade')) return 'SquareTrade';
  if (s.includes('choice') && s.includes('warranty')) return 'ChoiceHomeWarranty';
  return null;
};

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let outcomes = [];
  try {
    outcomes = await listRecentEventLog({
      action: 'claude_call_outcome',
      days_back: WINDOW_DAYS,
      limit: 2000,
    });
  } catch (e) { log('warranty_denial_query_failed', { error: String(e) }); }

  if (!outcomes || outcomes.length === 0) {
    await xano.markSignalProcessed(signal.id, 'warranty_denial_pattern_handled', { vendors_flagged: 0 });
    return { success: true, action: 'no_outcomes' };
  }

  // Bucket by vendor — need to cross-reference with warranty_claim_
  // action events to get the vendor. Per-job: outcome row has job_id;
  // we look up the matching warranty_claim_action_persisted row.
  // For overnight build, simplification: read warranty_claim_action_
  // persisted directly and use its outcome field.
  let claimActions = [];
  try {
    claimActions = await listRecentEventLog({
      action: 'warranty_claim_action_persisted',
      days_back: WINDOW_DAYS,
      limit: 2000,
    });
  } catch (_) {}

  const buckets = new Map();
  for (const row of claimActions) {
    let m;
    try { m = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { continue; }
    if (!m) continue;
    const vendor = VENDOR_NORMALIZER(m.vendor);
    if (!vendor) continue;
    if (!buckets.has(vendor)) buckets.set(vendor, { vendor, total: 0, bad: 0, neutral: 0, good: 0 });
    const b = buckets.get(vendor);
    b.total += 1;
    const escalated = m.escalate === true;
    const flagged = (m.high_flags || 0) > 0;
    if (escalated) b.bad += 1;
    else if (flagged) b.neutral += 1;
    else b.good += 1;
  }

  const flagged = [];
  for (const b of buckets.values()) {
    if (b.total < MIN_CLAIMS) continue;
    const denialRate = b.bad / b.total;
    if (denialRate >= DENIAL_RATE_THRESHOLD) {
      flagged.push({ ...b, denial_rate_pct: Math.round(denialRate * 100) });
    }
  }

  if (flagged.length === 0) {
    await xano.markSignalProcessed(signal.id, 'warranty_denial_pattern_handled', { vendors_flagged: 0, vendors_seen: buckets.size });
    return { success: true, action: 'no_pattern' };
  }

  const lines = [`[ant] ⚠ warranty denial-pattern alert (${WINDOW_DAYS}d):`, ''];
  for (const v of flagged) {
    lines.push(`${v.vendor}: ${v.denial_rate_pct}% escalated/blocked (${v.bad}/${v.total} claims)`);
  }
  lines.push('');
  lines.push('Investigate: vendor criteria changed? Our intake missing a field?');

  let smsResult;
  try { smsResult = await sms.toOwner(lines.join('\n'), { call_site: 'warranty_denial_pattern_detector' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  for (const v of flagged) {
    try {
      await recordEvent('vendor_denial_pattern_flagged', {
        vendor: v.vendor,
        denial_rate_pct: v.denial_rate_pct,
        total_claims: v.total,
        bad_claims: v.bad,
        window_days: WINDOW_DAYS,
        flagged_at_ms: Date.now(),
      });
    } catch (_) {}
  }

  await xano.markSignalProcessed(signal.id, 'warranty_denial_pattern_handled', {
    vendors_flagged: flagged.length,
    vendors_seen: buckets.size,
    sms_ok: !!(smsResult && smsResult.ok),
  });
  log('warranty_denial_pattern_alerted', { count: flagged.length });
  return { success: true, action: 'alerted' };
}
