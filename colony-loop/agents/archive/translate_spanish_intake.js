// Handles TRANSLATE_SPANISH_INTAKE signals. Sends Spanish text to Claude
// for translation, writes both to event_log + emits the English version
// downstream.
import { config } from '../config.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const sourceText = String(payload.source_text || '').trim();

  if (!jobId || !sourceText) {
    await xano.markSignalProcessed(signal.id, 'translate_spanish_intake_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  const apiKey = config.anthropicApiKey;
  if (!apiKey) {
    await xano.markSignalProcessed(signal.id, 'translate_spanish_intake_handled', { outcome: 'skipped_no_api_key' });
    return { success: false, action: 'skipped_no_api_key' };
  }

  let translated = '';
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
        max_tokens: 600,
        system: 'You are a Spanish-to-English translator for appliance-repair dispatch emails. Output only the English translation, no commentary.',
        messages: [{ role: 'user', content: sourceText.slice(0, 4000) }],
      }),
    });
    const data = await resp.json();
    translated = String((data && data.content && data.content[0] && data.content[0].text) || '').trim();
  } catch (err) {
    log('translate_spanish_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'translate_spanish_intake_handled', { outcome: 'claude_failed' });
    return { success: false, action: 'claude_failed' };
  }

  try {
    await xano.recordEventLog(`spanish_translated_${jobId}`, {
      job_id: jobId,
      source_text: sourceText.slice(0, 1000),
      translated_text: translated.slice(0, 2000),
      source_signal_id: signal.id,
    });
  } catch (e) { /* */ }

  const meta = { job_id: jobId, outcome: 'translated', char_count: translated.length };
  await xano.markSignalProcessed(signal.id, 'translate_spanish_intake_handled', meta);
  log('translate_spanish_intake_handled', meta);
  return { success: true, action: 'translated', translated };
}
