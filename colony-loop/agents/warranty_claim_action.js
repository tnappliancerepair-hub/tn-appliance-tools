// Handles WARRANTY_CLAIM_ACTION signals (emitted by every vendor-specific
// warranty agent — warranty_claim_request_ahs_claims.js,
// warranty_claim_request_frontdoor_claims.js, etc).
//
// Each vendor agent produces a structured 5-section Claude output:
//   1. CLAIM PAYLOAD       — key-value list / JSON the vendor portal wants
//   2. LANGUAGE OPTIMIZATION — exact text to paste in Diagnosis / Repair fields
//   3. DOCUMENTATION FLAGS  — table of missing TDR fields with risk levels
//   4. EXPECTED OUTCOME     — approval probability + ETA + risk factors
//   5. ESCALATION           — __ESCALATE_DANIELLE__ marker when human needed
//
// This agent:
//   - Persists the full claim_action_text to event_log so Danielle can pull
//     it up in Teddy Tool / warranty-review page.
//   - Detects __ESCALATE_DANIELLE__ marker → SMSes urgent escalation alert.
//   - Otherwise SMSes a clean digest with HIGH-flag count + review link.
//
// Dedup: vendor agents emit one signal per WARRANTY_CLAIM_REQUEST_* fire,
// so duplicate WARRANTY_CLAIM_ACTIONs only happen if the upstream signal
// fires twice. markSignalProcessed gives us single-shot processing per
// signal_id; we don't need additional dedup on job_id.
import { config } from '../config.js';
import { toDanielle } from '../sms.js';

const ESCALATE_MARKER = '__ESCALATE_DANIELLE__';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function countHighFlags(text) {
  // Section 3 is a markdown table with HIGH/MEDIUM/LOW risk levels. Count
  // rows where Risk column = HIGH. Defensive: lower-case match too.
  if (!text) return 0;
  const lines = text.split('\n');
  let count = 0;
  for (const l of lines) {
    if (/^\|/.test(l) && /\bHIGH\b/i.test(l)) count += 1;
  }
  return count;
}

function vendorDisplayFromSlug(slug) {
  // Map architect-built slugs to human-readable vendor labels for SMS.
  const map = {
    ahs_claims: 'AHS',
    frontdoor_claims: 'Frontdoor',
    authorization_request: 'Authorization',
    claim_language_optimizer: 'Language Optimizer',
    claims_status_watcher: 'Status Watcher',
    denial_pattern: 'Denial Analyzer',
    payment_reconciliation: 'Payment Reconciler',
    resubmission: 'Resubmission',
  };
  return map[slug] || slug.replace(/_/g, ' ');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'warranty_claim_action_handled', {
      outcome: 'skipped_missing_job_id',
    });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  const claimText = String(payload.claim_action_text || '').trim();
  if (!claimText) {
    const meta = { job_id: jobId, outcome: 'skipped_empty_text' };
    await xano.markSignalProcessed(signal.id, 'warranty_claim_action_handled', meta);
    log('warranty_claim_action_handled', meta);
    return { success: true, action: 'skipped_empty_text' };
  }

  const specialty = String(payload.specialty || '').toLowerCase();
  const vendorLabel = payload.specialty_display || vendorDisplayFromSlug(specialty);
  const escalate = claimText.includes(ESCALATE_MARKER);
  const highFlags = countHighFlags(claimText);

  // Persist the full claim text — Danielle can pull it up in event_log /
  // warranty-review page. Strip the escalate marker before persisting so
  // it doesn't appear in the digest UI.
  const persistText = escalate ? claimText.replace(new RegExp(ESCALATE_MARKER, 'g'), '').trim() : claimText;
  try {
    await xano.recordEventLog('warranty_claim_action_persisted', {
      job_id: jobId,
      specialty,
      vendor: vendorLabel,
      escalate,
      high_flags: highFlags,
      claim_action_text: persistText,
      generated_by: payload.generated_by || '',
      source_signal_id: signal.id,
      generated_at_ms: Date.now(),
    });
  } catch (err) {
    log('warranty_claim_action_persist_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // SMS Danielle. Escalate case gets a stronger tone + escalation reason hint.
  const reviewLink = `${bareDomain()}/warranty-review.html?job_id=${jobId}`;
  let body;
  if (escalate) {
    const reasonHint = (() => {
      const sectionMatch = claimText.match(/##\s*5\.?\s*ESCALATION[\s\S]*?\*\*Reason for escalation\*\*\s*[\(:]?\s*(?:specific\))?\s*([^\n]+)/i);
      if (sectionMatch) return sectionMatch[1].trim().slice(0, 80);
      return 'see warranty-review for details';
    })();
    body =
      `[ant] WARRANTY ESCALATION job #${jobId} (${vendorLabel}). Reason: ${reasonHint}. ` +
      `Cannot auto-submit. Review: ${reviewLink}`;
  } else if (highFlags > 0) {
    body =
      `[ant] warranty claim package ready for job #${jobId} (${vendorLabel}) - ` +
      `${highFlags} HIGH flag${highFlags === 1 ? '' : 's'}. Resolve before submission: ${reviewLink}`;
  } else {
    body =
      `[ant] warranty claim package ready for job #${jobId} (${vendorLabel}) - ` +
      `no flags, clear to submit. Open: ${reviewLink}`;
  }

  let smsRes = null;
  try {
    smsRes = await toDanielle(body, {
      action: 'warranty_claim_action_digest',
      job_id: jobId,
      specialty,
      escalate,
      high_flags: highFlags,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    job_id: jobId,
    specialty,
    vendor: vendorLabel,
    outcome: escalate ? 'escalated' : (highFlags > 0 ? 'flags_present' : 'ready'),
    high_flags: highFlags,
    text_chars: claimText.length,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'warranty_claim_action_handled', meta);
  log('warranty_claim_action_handled', meta);

  // ── Outcome learning: tag the claude calls for this job. Outcome
  // value reflects how the claim came out — 'good' (no flags, ready),
  // 'neutral' (flags present), 'bad' (escalated, blocked).
  try {
    const outcomeValue = escalate ? 'bad' : (highFlags > 0 ? 'neutral' : 'good');
    const { linkOutcomesForJob } = await import('./claude_outcome_linker.js');
    linkOutcomesForJob(signal, ctx, {
      outcomeType: 'warranty_claim_result',
      outcomeValue,
      lookbackDays: 7,
      entityKey: 'job_id',
      entityId: jobId,
    }).catch(() => {});
  } catch (_) {}

  return { success: true, action: meta.outcome, job_id: jobId };
}
