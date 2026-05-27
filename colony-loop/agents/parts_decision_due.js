// Handles PARTS_DECISION_DUE signals (emitted by parts_intelligence.js
// on the first supplier response per job, with a 90s deadline).
//
// Flow:
//   1. Hold-and-re-emit until Date.now() >= deadline_ms.
//   2. On deadline: check dedup (get_parts_decision_handled). Skip if
//      another agent already produced the aggregation row.
//   3. Pull all parts_intel_response rows for this job (each is one
//      supplier's Claude output).
//   4. Run Claude over the consolidated set with a "pick best" prompt
//      that surfaces cheapest in-stock + fastest ETA + the part number.
//   5. Persist the decision via event_log (action=parts_decision_aggregated)
//      and SMS Teddy + Danielle with the ORDER reply CTA.
//
// Output SMS shape (single line, ~150 chars):
//   [ant] parts ready to order for job #X: <part_name> from <supplier> $XX ETA <date>.
//   Reply ORDER to confirm.
import { config } from '../config.js';
import { toOwner, toDanielle } from '../sms.js';

const AGGREGATE_PROMPT = `You are the Parts Decision Aggregator for TN Appliance Exchange. You receive 2-5 supplier intel responses for a single appliance job — each one is a Claude-generated structured block from a parts_lookup_<supplier> agent (Marcone, Triple S, RepairClinic, PartSelect, AppliancePartsPros).

Your job is to compose ONE 1-line SMS body for the shop owner with the single best part-source pick. Optimize for: (a) in-stock now, (b) fastest delivery ETA, (c) lowest verified OEM price. When two suppliers tie, prefer Marcone (default OEM distributor for the shop).

Output EXACTLY this format on ONE line — no preamble, no other lines:

<part name short> from <Supplier> $<price> ETA <date or relative>

If no supplier has confidently in-stock data for the verified part, output:
NO_CLEAN_PICK — review supplier intel manually

Rules:
- Use the lowest in-stock confirmed price across suppliers.
- Use the shortest ETA across in-stock suppliers.
- Round prices to whole dollars unless precision is critical.
- Use the verified_part_number / failed_component name from input, not invented names.
- If only one supplier responded, pick it (note "(only response)" suffix).
- ETA: if a supplier gives a relative window (e.g. "ships next-day, arrives 2 days"), keep it short.
- One line only. No commentary outside the line.`;

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const deadlineMs = Number(payload.deadline_ms || payload.scheduled_for_ms || 0);

  if (!jobId || !deadlineMs) {
    await xano.markSignalProcessed(signal.id, 'parts_decision_due_handled', {
      outcome: 'skipped_missing_payload',
    });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // 1. Hold-and-re-emit until deadline.
  if (Date.now() < deadlineMs) {
  // Dedup: if multiple pending signals exist for this job, skip the
  // re-emit and mark current processed. Collapses runaway dupes over a
  // few ticks back to steady-state 1 pending per job. Prevents the
  // duplicate-SMS-at-deadline bug.
  try {
    const counts = await xano.countPendingSignalsForJob('PARTS_DECISION_DUE', jobId);
    if (counts && counts.pending_count > 1) {
      log('dedup_skip_reemit', { job_id: jobId, pending_count: counts.pending_count, type: 'PARTS_DECISION_DUE' });
      await xano.markSignalProcessed(signal.id, 'parts_decision_due_handled', {
        job_id: jobId, outcome: 'dedup_skip_reemit', pending_count: counts.pending_count,
      });
      return { success: true, action: 'dedup_skip_reemit', job_id: jobId };
    }
  } catch (e) {
    log('dedup_check_failed', { job_id: jobId, type: 'PARTS_DECISION_DUE', error: String(e.message || e) });
  }

    try {
      await xano.emitSignal({
        signal_type: 'PARTS_DECISION_DUE',
        signal_strength: 60,
        payload,
      });
    } catch (err) {
      log('parts_decision_hold_failed', { job_id: jobId, error: String(err.message || err) });
    }
    const meta = { job_id: jobId, outcome: 'held_until_deadline', deadline_ms: deadlineMs };
    await xano.markSignalProcessed(signal.id, 'parts_decision_due_handled', meta);
    return { success: true, action: 'held_until_deadline', job_id: jobId };
  }

  // 2. Dedup check.
  try {
    const handled = await xano.getPartsDecisionHandled(jobId);
    if (handled && handled.handled) {
      const meta = { job_id: jobId, outcome: 'skipped_duplicate', last_handled_at: handled.last_handled_at };
      await xano.markSignalProcessed(signal.id, 'parts_decision_due_handled', meta);
      log('parts_decision_due_handled', meta);
      return { success: true, action: 'skipped_duplicate', job_id: jobId };
    }
  } catch (err) {
    log('parts_decision_handled_check_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // 3. Pull all supplier responses for this job.
  let intelRows = [];
  try {
    const r = await xano.getPartsIntelForJob(jobId);
    intelRows = (r && r.rows) || [];
  } catch (err) {
    log('parts_intel_load_failed', { job_id: jobId, error: String(err.message || err) });
  }

  if (intelRows.length === 0) {
    const meta = { job_id: jobId, outcome: 'no_supplier_responses' };
    await xano.markSignalProcessed(signal.id, 'parts_decision_due_handled', meta);
    log('parts_decision_due_handled', meta);
    return { success: true, action: 'no_supplier_responses', job_id: jobId };
  }

  // 4. Claude aggregation.
  const userMessage = intelRows
    .map((r, i) => {
      const meta = r.metadata || {};
      return `--- Supplier ${i + 1}: ${meta.specialty_display || meta.specialty || meta.generated_by || 'unknown'} ---\n${(meta.intel_text || '').slice(0, 4000)}`;
    })
    .join('\n\n');

  let pickLine = '';
  try {
    const resp = await claude.callClaude({
      system: AGGREGATE_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      model: config.claudeModel,
    });
    pickLine = (claude.textFromResponse ? claude.textFromResponse(resp) : '').trim().split('\n')[0].trim();
  } catch (err) {
    pickLine = '';
    log('parts_decision_claude_failed', { job_id: jobId, error: String(err.message || err) });
  }

  // 5. Persist the decision + SMS Teddy & Danielle.
  try {
    await xano.recordEventLog('parts_decision_aggregated', {
      job_id: jobId,
      pick_line: pickLine,
      supplier_count: intelRows.length,
      source_signal_id: signal.id,
      decided_at_ms: Date.now(),
    });
  } catch (err) {
    log('parts_decision_persist_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const reviewLink = `${bareDomain()}/job-detail.html?job_id=${jobId}`;
  let body;
  if (!pickLine || /^NO_CLEAN_PICK/i.test(pickLine)) {
    body =
      `[ant] parts intel for job #${jobId} - no clean supplier pick (${intelRows.length} responses). ` +
      `Review manually: ${reviewLink}`;
  } else {
    body = `[ant] parts ready to order for job #${jobId}: ${pickLine}. Reply ORDER to confirm.`;
  }

  let teddyRes = null;
  let danielleRes = null;
  try {
    teddyRes = await toOwner(body, {
      action: 'parts_decision_digest',
      job_id: jobId,
      supplier_count: intelRows.length,
      source_signal_id: signal.id,
    });
  } catch (err) {
    teddyRes = { success: false, error: String(err.message || err) };
  }
  try {
    danielleRes = await toDanielle(body, {
      action: 'parts_decision_digest',
      job_id: jobId,
      supplier_count: intelRows.length,
      source_signal_id: signal.id,
    });
  } catch (err) {
    danielleRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    job_id: jobId,
    outcome: 'decision_sent',
    pick_line: pickLine.slice(0, 200),
    supplier_count: intelRows.length,
    teddy_sms: teddyRes && teddyRes.success ? 'ok' : 'maybe_failed',
    danielle_sms: danielleRes && danielleRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'parts_decision_due_handled', meta);
  log('parts_decision_due_handled', meta);

  return { success: true, action: 'decision_sent', job_id: jobId };
}
