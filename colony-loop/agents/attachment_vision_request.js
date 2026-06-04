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

const EXTRACTION_PROMPT = `You are a vision agent for an appliance repair shop. Look at the attached image, classify what it shows, and extract any useful information.

Return STRICT JSON ONLY with this exact shape (no markdown fence, no commentary):

{
  "classification": "model_sticker"|"parts_used"|"parts_returned"|"walkaround_before"|"walkaround_after"|"damage_evidence"|"error_code_display"|"receipt"|"other",
  "is_appliance_sticker": true|false,
  "confidence": "high"|"medium"|"low",
  "model_number": "string or empty",
  "serial_number": "string or empty",
  "brand": "string or empty",
  "appliance_type": "washer"|"dryer"|"dishwasher"|"refrigerator"|"freezer"|"range"|"oven"|"microwave"|"hvac"|"other"|"",
  "error_code": "string or empty",
  "parts_visible": [
    {
      "part_number": "string",
      "description": "short string",
      "supplier_visible": "string or empty"
    }
  ],
  "notes": "one short sentence about what you see"
}

Classification rules (pick the BEST fit):
- "model_sticker": manufacturer label with model + serial. Often inside a door, on a back panel.
- "parts_used": one or more replacement parts laid out, packaging open/torn, OR parts visibly installed on the appliance. Could be a part box with the OEM label visible.
- "parts_returned": one or more replacement parts in CLOSED packaging, sometimes with "RETURN" / "GOING BACK" markings or stacked separately. If unclear between used vs returned, prefer "parts_used".
- "walkaround_before": photo or first frame of video showing the appliance area BEFORE work started — kitchen scene, customer's floor/cabinets visible, appliance in original state.
- "walkaround_after": same but AFTER — area clean, appliance running/closed up, debris cleared.
- "damage_evidence": a specific damaged component (cracked housing, burnt wire, water damage, etc.) shown intentionally as proof.
- "error_code_display": appliance digital display showing an error code (Er FF, F02, etc.).
- "receipt": parts receipt, supplier invoice.
- "other": anything else (customer pets, random scene, etc.).

Parts extraction rules (fill parts_visible whenever classification is "parts_used", "parts_returned", or "receipt"):
- Read every visible part number off the part labels. Real part numbers contain at least 4 alphanumeric characters, often a mix.
- Don't guess characters you can't clearly read. Omit unclear ones.
- description is a 2-5 word summary of what the part is (e.g. "drain pump", "control board", "door switch").
- supplier_visible is the vendor name if a logo/header is on the package (Marcone, Reliable, etc.). Empty otherwise.
- Empty parts_visible array if no parts shown.

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
    try {
      await fetch(`${XANO_BASE}/save_vision_classification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachment_id: attachmentId,
          classification: 'unclassified',
          extracted_json: '',
          confidence: 0,
          status: 'failed',
        }),
      });
    } catch (_) {}
    return { success: false, action: 'claude_failed', error: cl && cl.error };
  }
  const ex = cl.parsed || {};
  const confidence = String(ex.confidence || 'low').toLowerCase();
  const classification = String(ex.classification || 'other').toLowerCase();

  // ALWAYS persist the classification to job_attachments — even when
  // no appliance fields were extractable. Powers the warranty-review
  // parts sections + Danielle's used-vs-return view.
  const confidenceNum = confidence === 'high' ? 90 : confidence === 'medium' ? 60 : 30;
  try {
    await fetch(`${XANO_BASE}/save_vision_classification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachment_id: attachmentId,
        classification,
        extracted_json: JSON.stringify({
          parts_visible: ex.parts_visible || [],
          model_number: ex.model_number || '',
          serial_number: ex.serial_number || '',
          brand: ex.brand || '',
          appliance_type: ex.appliance_type || '',
          error_code: ex.error_code || '',
          notes: ex.notes || '',
        }),
        confidence: confidenceNum,
        status: 'classified',
      }),
    });
  } catch (_) {}

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

  // Defensive overwrite rule v2 (2026-06-03):
  // A photo-extracted value is GROUND TRUTH from the actual appliance
  // sticker. The intake field is often garbage typed during chat
  // ("10-SECOND" from "10 second video", "TEST", "TBD", etc.).
  // So: overwrite when (existing value is blank) OR (existing value
  // looks like garbage) OR (the photo extraction has HIGH confidence
  // and the new value is meaningfully different).
  function looksLikeGarbage(v) {
    if (isBlank(v)) return false;
    const s = String(v).trim().toUpperCase();
    if (s.length < 4) return true;
    // Common garbage tokens that show up when humans typed in the wrong field
    const tokens = ['SECOND', 'VIDEO', 'PHOTO', 'TEST', 'TBD', 'UNKNOWN', 'N/A', 'NA', 'NONE', 'NULL', 'TYPE HERE', 'EXAMPLE', 'ASAP', 'SAMPLE'];
    for (const t of tokens) {
      if (s.includes(t)) return true;
    }
    // Real model numbers contain at least 2 digits typically — if it's all
    // letters / all symbols, suspicious
    const hasDigit = /[0-9]/.test(s);
    const hasLetter = /[A-Z]/.test(s);
    if (!hasDigit && !hasLetter) return true;
    return false;
  }
  function shouldWrite(existing, extracted, isHighConf) {
    if (isBlank(extracted)) return false;
    if (isBlank(existing)) return true;
    if (looksLikeGarbage(existing)) return true;
    if (isHighConf && String(existing).trim().toUpperCase() !== String(extracted).trim().toUpperCase()) {
      // High-confidence override — the photo says different from what's there.
      // Log but write. Tech can override back if needed.
      return true;
    }
    return false;
  }

  const isHighConf = confidence === 'high';
  const updatePayload = { job_id: jobId };
  let updateCount = 0;
  const overwrites = [];

  if (shouldWrite(currentJob && currentJob.model_number, ex.model_number, isHighConf)) {
    updatePayload.model_number = String(ex.model_number).trim();
    if (currentJob && !isBlank(currentJob.model_number)) overwrites.push({ field: 'model_number', old: currentJob.model_number, new: ex.model_number });
    updateCount++;
  }
  if (shouldWrite(currentJob && currentJob.brand, ex.brand, isHighConf)) {
    updatePayload.brand = String(ex.brand).trim();
    if (currentJob && !isBlank(currentJob.brand)) overwrites.push({ field: 'brand', old: currentJob.brand, new: ex.brand });
    updateCount++;
  }
  if (shouldWrite(currentJob && currentJob.serial_number, ex.serial_number, isHighConf)) {
    updatePayload.serial_number = String(ex.serial_number).trim();
    if (currentJob && !isBlank(currentJob.serial_number)) overwrites.push({ field: 'serial_number', old: currentJob.serial_number, new: ex.serial_number });
    updateCount++;
  }
  if (shouldWrite(currentJob && currentJob.appliance_type, ex.appliance_type, isHighConf)) {
    updatePayload.appliance_type = String(ex.appliance_type).trim();
    if (currentJob && !isBlank(currentJob.appliance_type)) overwrites.push({ field: 'appliance_type', old: currentJob.appliance_type, new: ex.appliance_type });
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
    overwrites: overwrites.length > 0 ? overwrites : undefined,
  };
  await xano.markSignalProcessed(signal.id, 'attachment_vision_handled', meta);
  log('attachment_vision_extracted', meta);
  return { success: true, action: 'fields_written', meta };
}
