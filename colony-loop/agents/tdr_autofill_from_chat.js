// Handles TDR_AUTOFILL_FROM_CHAT signals (emitted by tech-ant-live when
// the tech taps a 'auto-fill TDR' button). Pulls the chat transcript
// for the job + asks Claude to extract the 5 TDR fields, then writes
// them as a draft TDR row attributed to technician_id (NOT teddy id=1).
//
// The tech reviews + edits before the server TDR completeness gate
// would allow tech_job_complete.
import { config } from '../config.js';

const SYSTEM_PROMPT = `You are extracting TDR (Technician Decision Report) fields from a repair-chat transcript. Output STRICT JSON with these keys:
{
  "diagnosis": "...",            // 1-2 sentence diagnosis of root cause
  "failure_cause": "...",        // single phrase root cause (e.g. "compressor failure", "clogged drain")
  "failed_component": "...",     // part that failed (e.g. "evaporator fan motor", "drain pump")
  "labor_time_hours": 0.0,       // decimal hours on site (best estimate)
  "repair_completed": "...",     // 1-2 sentences of what was done
  "confidence": 0.0              // 0-1 confidence in the extraction
}
If you can't determine a field with reasonable confidence, leave it empty string (or 0). Don't fabricate.`;

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const techId = Number(payload.technician_id || 0);
  const transcript = String(payload.transcript || '').trim();

  if (!jobId || !techId || !transcript) {
    await xano.markSignalProcessed(signal.id, 'tdr_autofill_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Call Claude
  const apiKey = config.anthropicApiKey;
  if (!apiKey) {
    await xano.markSignalProcessed(signal.id, 'tdr_autofill_handled', { outcome: 'skipped_no_api_key' });
    return { success: false, action: 'skipped_no_api_key' };
  }

  let extracted = null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Transcript:\n\n${transcript.slice(0, 6000)}\n\nReturn ONLY the JSON.` },
        ],
      }),
    });
    const data = await resp.json();
    const txt = data && data.content && data.content[0] && data.content[0].text;
    const cleaned = String(txt || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    extracted = JSON.parse(cleaned);
  } catch (err) {
    log('tdr_autofill_claude_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'tdr_autofill_handled', {
      outcome: 'claude_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'claude_failed' };
  }

  // Write the extracted fields as audit log (tech reviews via tech-ant-live)
  try {
    await xano.recordEventLog(`tdr_autofill_extracted_${jobId}`, {
      job_id: jobId,
      technician_id: techId,
      extracted_fields: extracted,
      confidence: extracted.confidence || 0,
      source_signal_id: signal.id,
    });
  } catch (err) { /* */ }

  const meta = {
    job_id: jobId,
    technician_id: techId,
    outcome: 'extracted',
    confidence: extracted.confidence || 0,
    has_diagnosis: !!extracted.diagnosis,
    has_failure_cause: !!extracted.failure_cause,
    has_failed_component: !!extracted.failed_component,
    has_repair_completed: !!extracted.repair_completed,
    labor_time_hours: extracted.labor_time_hours || 0,
  };
  await xano.markSignalProcessed(signal.id, 'tdr_autofill_handled', meta);
  log('tdr_autofill_handled', meta);
  return { success: true, action: 'extracted', extracted };
}
