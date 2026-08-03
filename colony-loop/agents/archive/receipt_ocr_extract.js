// Handles RECEIPT_OCR_EXTRACT signals (emitted when a tech uploads a
// parts receipt photo via tech-ant-live). Sends the image URL to Claude
// for OCR + structured extraction of {vendor, total, part_numbers[]}.
import { config } from '../config.js';

const SYSTEM_PROMPT = `You are extracting structured data from a parts/supply receipt image. Output STRICT JSON:
{
  "vendor": "...",          // store name e.g. "Home Depot", "Marcone Supply"
  "total_cents": 0,         // grand total in cents
  "tax_cents": 0,           // tax line in cents (or 0)
  "items": [                // line items (best effort)
    { "description": "...", "part_number": "...", "quantity": 1, "unit_price_cents": 0 }
  ],
  "date": "YYYY-MM-DD",     // if present
  "confidence": 0.0         // 0-1 overall confidence
}
If a field can't be determined, use empty string / 0 / empty array. Don't fabricate.`;

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const techId = Number(payload.technician_id || 0);
  const imageUrl = String(payload.image_url || '').trim();

  if (!jobId || !techId || !imageUrl) {
    await xano.markSignalProcessed(signal.id, 'receipt_ocr_extract_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  const apiKey = config.anthropicApiKey;
  if (!apiKey) {
    await xano.markSignalProcessed(signal.id, 'receipt_ocr_extract_handled', { outcome: 'skipped_no_api_key' });
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
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: 'Extract structured receipt data. Return ONLY the JSON.' },
          ],
        }],
      }),
    });
    const data = await resp.json();
    const txt = data && data.content && data.content[0] && data.content[0].text;
    const cleaned = String(txt || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    extracted = JSON.parse(cleaned);
  } catch (err) {
    log('receipt_ocr_claude_failed', { job_id: jobId, error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'receipt_ocr_extract_handled', {
      outcome: 'claude_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'claude_failed' };
  }

  try {
    await xano.recordEventLog(`receipt_ocr_extracted_${jobId}_${Date.now()}`, {
      job_id: jobId,
      technician_id: techId,
      image_url: imageUrl,
      extracted,
      confidence: extracted.confidence || 0,
      source_signal_id: signal.id,
    });
  } catch (e) { /* */ }

  const meta = {
    job_id: jobId,
    technician_id: techId,
    outcome: 'extracted',
    vendor: extracted.vendor || '',
    total_cents: extracted.total_cents || 0,
    item_count: (extracted.items || []).length,
    confidence: extracted.confidence || 0,
  };
  await xano.markSignalProcessed(signal.id, 'receipt_ocr_extract_handled', meta);
  log('receipt_ocr_extract_handled', meta);
  return { success: true, action: 'extracted', extracted };
}
