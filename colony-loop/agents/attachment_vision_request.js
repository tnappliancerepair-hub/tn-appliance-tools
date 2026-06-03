// Signal in: ATTACHMENT_VISION_REQUEST
// Signal out: ATTACHMENT_FIELDS_EXTRACTED (audit-only — no downstream
// consumers yet, but emitted so future agents could subscribe)
//
// Purpose: every time a photo is uploaded to a job (customer chat,
// customer portal, tech CaptureOverlay — any source), feed it to
// Claude vision and extract model_number, serial_number, brand,
// appliance_type, error_code. Write extracted values straight to the
// job row via update_job_appliance_fields. Teddy Tool refreshes and
// sees the populated fields without anyone typing.
//
// Defensive write rules:
//   - Only update FIELDS THAT ARE BLANK on the job row
//   - Never overwrite a value that's already there (the tech may have
//     typed something different than what the photo says, and they
//     win)
//   - Skip if the photo is clearly not an appliance sticker (low
//     confidence reply)
//
// Cost: Claude vision call per photo upload. Estimated $0.01-0.05 per
// extraction depending on model. Probably ~2-5 photos per job × ~5
// jobs/day per active job = $5-50/mo total at current volume. Cheap
// for the productivity unlock (eliminates 30+ sec of typing per job).

import { config } from '../config.js';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const NETLIFY_BASE = config.publicSiteBase || 'https://tnapplianceexchange.net';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANT_VISION_MODEL || 'claude-haiku-4-5-20251001';

const EXTRACTION_PROMPT = `You are a vision agent for an appliance repair shop. Look at the attached image and extract any appliance-identifying information you can see.

Return STRICT JSON ONLY with this exact shape (no markdown fence, no commentary):

{
  "is_appliance_sticker": true|false,
  "confidence": "high"|"medium"|"low",
  "model_number": "string or empty",
  "serial_number": "string or empty",
  "brand": "string or empty",
  "appliance_type": "washer"|"dryer"|"dishwasher"|"refrigerator"|"freezer"|"range"|"oven"|"microwave"|"hvac"|"other"|"",
  "error_code": "string or empty",
  "notes": "one short sentence about what you see"
}

Extraction rules:
- A "model sticker" is a manufacturer label, usually with a model number, serial number, and brand. Often inside a door, on a back panel, or under a lid.
- If the image shows a model sticker → is_appliance_sticker=true, fill model/serial/brand if visible.
- If the image shows an error code on a display (Er FF, F02, etc.) → fill error_code, leave is_appliance_sticker=false unless a model is also visible.
- If the image shows a part (control board, fan motor, etc.) with a part number → put the part number in model_number IF AND ONLY IF the larger label is clearly a part sticker (sometimes parts have their own model-like identifiers).
- If the image shows generic appliance, kitchen scene, customer's living room, person's face, etc. → is_appliance_sticker=false, confidence=low, leave fields empty.
- DO NOT make up values you can't read. If a character is unclear, omit the field rather than guessing.
- model_number is the alphanumeric identifier like "WRF555SDFZ" or "LFXS26973S" or "WTW5000DW2". Usually 6-15 characters.
- brand is the manufacturer like "Whirlpool", "LG", "Samsung", "GE", "Maytag", "Frigidaire", "Electrolux", "Bosch", "KitchenAid", "Amana", "Kenmore", "Hotpoint". Use the canonical capitalization.`;

async function loadAttachmentRow(attachmentId) {
  // Reuse get_attachment_view_url to fetch a signed S3 URL for the image
  const r = await fetch(`${NETLIFY_BASE}/.netlify/functions/s3-view-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ s3_keys: [String(attachmentId)] }),
  });
  return r;
}

async function callClaudeWithImage(imageUrl, log) {
  if (!ANTHROPIC_KEY) {
    log('attachment_vision_skipped', { reason: 'no_api_key' });
    return null;
  }

  const body = {
    model: MODEL,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);
  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return { error: 'claude_call_failed: ' + (e.message || String(e)) };
  }
  clearTimeout(timer);
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    return { error: 'claude_non_2xx: ' + resp.status + ' ' + errBody.slice(0, 300) };
  }
  const data = await resp.json();
  const blocks = data.content || [];
  const textBlock = blocks.find((b) => b.type === 'text');
  if (!textBlock) return { error: 'no_text_block' };

  // Parse strict JSON from Claude's reply (strip any accidental markdown)
  let raw = (textBlock.text || '').trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return { parsed: JSON.parse(raw) };
  } catch (e) {
    return { error: 'json_parse_failed', raw: raw.slice(0, 400) };
  }
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const p = signal.payload || {};
  const jobId = Number(p.job_id || 0);
  const attachmentId = Number(p.attachment_id || 0);
  const fileType = String(p.file_type || '').toLowerCase();
  const s3Key = String(p.s3_key || '');

  if (!jobId || !attachmentId) {
    await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', { outcome: 'missing_inputs' });
    return { success: false, action: 'missing_inputs' };
  }

  // Only process photos. Videos can't be sent to Claude vision today.
  if (fileType && fileType !== 'photo' && fileType !== 'image') {
    await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', { outcome: 'skipped_non_image', file_type: fileType });
    return { success: true, action: 'skipped_non_image' };
  }

  // Get a signed S3 URL for the image
  let signedUrl = '';
  try {
    const r = await fetch(`${NETLIFY_BASE.replace(/\/$/,'')}/.netlify/functions/s3-view-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ s3_keys: [s3Key] }),
    });
    const d = await r.json();
    if (d && d.success && Array.isArray(d.signed_urls) && d.signed_urls[0]) {
      signedUrl = d.signed_urls[0].view_url || '';
    }
  } catch (e) {
    await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', { outcome: 'signed_url_failed', error: String(e.message || e) });
    return { success: false, action: 'signed_url_failed' };
  }

  if (!signedUrl) {
    await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', { outcome: 'no_signed_url' });
    return { success: false, action: 'no_signed_url' };
  }

  const cl = await callClaudeWithImage(signedUrl, log);
  if (!cl || cl.error) {
    await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', { outcome: 'claude_failed', error: cl && cl.error });
    return { success: false, action: 'claude_failed', error: cl && cl.error };
  }
  const ex = cl.parsed || {};
  const confidence = String(ex.confidence || 'low').toLowerCase();

  if (confidence === 'low' || !ex.is_appliance_sticker && !ex.model_number && !ex.serial_number && !ex.brand && !ex.error_code) {
    await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', {
      outcome: 'no_extractable_data',
      confidence,
      notes: ex.notes || '',
    });
    return { success: true, action: 'no_extractable_data' };
  }

  // Defensive write — only set fields that are currently blank on the job.
  // Fetch the job, then only POST fields that are empty on the row.
  let currentJob = null;
  try {
    const r = await fetch(`${XANO_BASE}/get_customer_job_view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, phone_last4: '__internal_bypass__' }),
    });
    const d = await r.json();
    if (d && d.success && d.job) currentJob = d.job;
  } catch (_) { currentJob = null; }

  const isBlank = (v) => !v || String(v).trim() === '';
  const updatePayload = { job_id: jobId };
  let updateCount = 0;

  if (ex.model_number && (!currentJob || isBlank(currentJob.model_number))) {
    updatePayload.model_number = String(ex.model_number).trim();
    updateCount++;
  }
  if (ex.brand && (!currentJob || isBlank(currentJob.brand))) {
    updatePayload.brand = String(ex.brand).trim();
    updateCount++;
  }
  if (ex.serial_number && (!currentJob || isBlank(currentJob.serial_number))) {
    updatePayload.serial_number = String(ex.serial_number).trim();
    updateCount++;
  }
  if (ex.appliance_type && (!currentJob || isBlank(currentJob.appliance_type))) {
    updatePayload.appliance_type = String(ex.appliance_type).trim();
    updateCount++;
  }

  if (updateCount === 0) {
    await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', {
      outcome: 'no_blank_fields_to_fill',
      extracted: { model: ex.model_number, brand: ex.brand, serial: ex.serial_number },
      confidence,
    });
    return { success: true, action: 'no_blank_fields_to_fill' };
  }

  let writeRes = null;
  try {
    const r = await fetch(`${XANO_BASE}/update_job_appliance_fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload),
    });
    writeRes = await r.json();
  } catch (e) {
    await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', { outcome: 'write_failed', error: String(e.message || e) });
    return { success: false, action: 'write_failed' };
  }

  // Emit downstream signal for anyone subscribing
  try {
    await xano.emitSignal({
      signal_type: 'ATTACHMENT_FIELDS_EXTRACTED',
      signal_strength: 50,
      payload: {
        job_id: jobId,
        attachment_id: attachmentId,
        extracted: {
          model_number: ex.model_number || '',
          brand: ex.brand || '',
          serial_number: ex.serial_number || '',
          appliance_type: ex.appliance_type || '',
          error_code: ex.error_code || '',
        },
        confidence,
        source_signal_id: signal.id,
      },
    });
  } catch (_) {}

  const meta = {
    outcome: 'fields_written',
    fields_written: updateCount,
    confidence,
    model_number: ex.model_number || '',
    brand: ex.brand || '',
    serial_number: ex.serial_number || '',
    appliance_type: ex.appliance_type || '',
    error_code: ex.error_code || '',
    notes: ex.notes || '',
  };
  await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', meta);
  log('attachment_vision_extracted', meta);
  return { success: true, action: 'fields_written', meta };
}
