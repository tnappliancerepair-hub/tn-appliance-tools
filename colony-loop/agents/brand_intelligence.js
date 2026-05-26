// Handles BRAND_INTELLIGENCE signals (emitted by each brand_*.js agent
// after Claude generates the brand-platform intelligence block).
//
// Composes a draft TDR (failed_component, failure_cause, suggested test,
// part recommendation, labor time estimate) from the brand intelligence
// text + the prior diagnostic brief (looked up by job_id), persists the
// draft into event_log, and SMSes Teddy a deep-link to teddy-tdr-tool
// so he can confirm or edit before the tech rolls.
//
// Closes the chain:
//   JOB_CREATED → DIAGNOSE_<APPLIANCE> → DIAGNOSTIC_BRIEF
//     → BRAND_LOOKUP_<SLUG> → BRAND_INTELLIGENCE
//       → tdr_suggestion (this agent) → event_log + Teddy SMS
//
// Why a dedicated TDR_SUGGESTION_DRAFTED action vs. a structured TDR row:
// the technician_decision_report table is the production TDR record —
// it gets written when the tech submits one. The suggestion is a
// pre-visit hint surfaced to Teddy in the tool; persisting it in
// event_log keeps the production TDR table clean of speculative content.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

const SUGGESTION_PROMPT = `You are the TDR Suggestion Agent for TN Appliance Exchange. You receive two upstream Claude outputs about a single job — a top-3 failure-mode diagnostic brief AND a brand-platform intelligence block — and you produce a single concise pre-visit TDR draft for Teddy to confirm or edit.

Output exactly this structure with these field labels:

Failed component: [one short noun phrase — the part you bet is bad]
Failure cause:    [one short phrase — why it's bad, mechanism level]
Confirm test:     [one sentence — what the tech should physically do or measure to verify]
Recommended part: [OEM part number(s) if confidently inferrable from model + platform; else "verify via model lookup"]
Labor estimate:   [X-Y minutes]
Pre-order parts:  [yes/no — yes when confidence is high enough to order before the visit]

Rules:
- Pick the single highest-probability failure from the diagnostic brief — not all three.
- If the brand-platform intelligence highlights a known-defect pattern that matches the customer symptom, weight that over the generic diagnostic brief.
- Never fabricate part numbers. When unsure, write "verify via model lookup".
- Keep each value to one short line. No bullets, no extra commentary, no preamble.
- Output is the field block only. Nothing before or after it.`;

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'tdr_suggestion_drafted', { outcome: 'skipped_missing_job_id' });
    return { success: false, action: 'skipped_missing_job_id' };
  }

  const intelText = String(payload.intel_text || '').trim();
  if (!intelText) {
    const meta = { job_id: jobId, outcome: 'skipped_empty_intel' };
    await xano.markSignalProcessed(signal.id, 'tdr_suggestion_drafted', meta);
    log('tdr_suggestion_drafted', meta);
    return { success: true, action: 'skipped_empty_intel' };
  }

  const userMessage = [
    'Brand: ' + (payload.brand_display || payload.brand || 'unknown'),
    'Appliance: ' + (payload.appliance_type || 'unknown'),
    'Model: ' + (payload.model_number || 'unknown'),
    'Customer symptom: ' + (payload.problem_summary || '(none)'),
    '',
    '--- Diagnostic brief (top-3 failure modes) ---',
    String(payload.prior_diagnostic_brief || '(not propagated — derive from intel block)'),
    '',
    '--- Brand intelligence ---',
    intelText,
  ].join('\n');

  let draftText = '';
  try {
    const resp = await claude.callClaude({
      system: SUGGESTION_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      model: config.claudeModel,
    });
    draftText = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim();
  } catch (err) {
    const meta = { job_id: jobId, outcome: 'claude_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'tdr_suggestion_drafted', meta);
    log('tdr_suggestion_drafted', meta);
    return { success: false, action: 'claude_failed', job_id: jobId };
  }

  // Persist the draft via the existing recordEventLog helper. Teddy Tool
  // (and any future dashboard) can read this row to surface the draft on
  // the job-detail page or the TDR composer.
  try {
    await xano.recordEventLog('tdr_suggestion_drafted', {
      job_id: jobId,
      brand: payload.brand || '',
      brand_display: payload.brand_display || '',
      appliance_type: payload.appliance_type || '',
      model_number: payload.model_number || '',
      draft_text: draftText,
      generated_at_ms: Date.now(),
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('tdr_suggestion_persist_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // SMS Teddy a deep-link. Short body — the full draft lives in event_log
  // and Teddy can pull it via Teddy Tool. Includes a 1-line preview so he
  // can decide at-a-glance whether to dig in.
  const previewLine = draftText.split('\n').find((l) => l.toLowerCase().startsWith('failed component:')) || draftText.slice(0, 80);
  const bareDomain = (config.publicSiteBase || '').replace(/^https?:\/\//, '');
  const body =
    `[ant] pre-visit TDR draft ready for job #${jobId} (${payload.brand_display || payload.brand || 'brand'} ${payload.appliance_type || ''}). ` +
    `${previewLine.trim()}. Confirm or edit: ${bareDomain}/teddy-tdr-tool.html?job_id=${jobId}`;

  let smsRes;
  try {
    smsRes = await toOwner(body, {
      action: 'tdr_suggestion_sms',
      job_id: jobId,
      brand: payload.brand || '',
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    job_id: jobId,
    outcome: 'tdr_suggestion_drafted',
    draft_chars: draftText.length,
    brand: payload.brand || '',
    appliance_type: payload.appliance_type || '',
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'tdr_suggestion_drafted', meta);
  log('tdr_suggestion_drafted', meta);

  return { success: true, action: 'tdr_suggestion_drafted', job_id: jobId };
}
