// Vision OCR — classify a tech photo and extract structured data.
//
// Classifies into 3 buckets via one Claude Vision call:
//   - model_sticker -> extract model_number + serial + brand + type,
//     write to job.model_number (only if empty)
//   - part_sticker  -> extract part_number + description, append to
//     TDR.parts_needed (deduped, never overwrites tech input)
//   - none          -> no writes
//
// Conservative classifier — better to miss than hallucinate. Tech sees
// a toast only when something is captured.
//
// Request:  POST { job_id, tech_id?, image_url, attachment_id? }
// Response: { kind, model_number?, serial_number?, manufacturer?,
//             appliance_type?, part_number?, part_description?,
//             confidence?, wrote: bool }

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
// Sonnet reads scuffed/angled nameplates far more accurately than Haiku — the
// model number drives every part order, so accuracy beats the pennies saved.
// (Teddy 7/4: John's photo gave the wrong model number.)
const ANTHROPIC_MODEL = 'claude-sonnet-5';

const PROMPT = `You're an expert at reading appliance nameplates and part labels. Classify this image into ONE of three buckets and extract structured data.

BUCKET 1 - "model_sticker": the appliance manufacturer's NAMEPLATE on a washer / dryer / refrigerator / dishwasher / range / oven / microwave / HVAC unit. Has "Model" / "Model #" / "Model No." / "MOD" text plus an alphanumeric model code (e.g. WTW5000DW2, GTW465ASN0WW, RF28HFEDBSR). Often also a Serial # and manufacturer logo.

BUCKET 2 - "part_sticker": a label on a SINGLE COMPONENT — drive belt, control board, water valve, pump, motor, capacitor, switch. Usually shows a Part # / P/N / Part No. with an alphanumeric code (e.g. 8540101, WPW10730972, W11315838) and may show brand + a short description.

BUCKET 3 - "none": anything else (room photo, appliance front exterior, person, food, error code display, generic object, damage close-up without a part visible).

Return STRICT JSON:

If model sticker:
{"kind": "model_sticker", "model_number": "EXACT_CODE_AS_PRINTED", "raw_model_line": "the full text of the line the model sits on", "serial_number": "...", "manufacturer": "Whirlpool|Samsung|GE|LG|Maytag|Kenmore|Frigidaire|KitchenAid|Bosch|Amana|other", "appliance_type": "washer|dryer|refrigerator|dishwasher|range|oven|microwave|hvac|other", "confidence": "high|medium|low"}

If part sticker:
{"kind": "part_sticker", "part_number": "EXACT_CODE", "part_description": "short description if visible, else ''", "manufacturer": "brand if visible, else ''", "confidence": "high|medium|low"}

If none:
{"kind": "none"}

HOW TO READ A MODEL NUMBER (do this carefully — a wrong model orders the wrong part):
- Transcribe the code EXACTLY as printed, character by character. Do NOT normalize, "correct", complete, or guess it into a model you recognize.
- Read ONLY the value on the line labeled "Model" / "Model No." / "MOD". If the plate also shows Serial / Type / Config / a UPC / a "part of" number, DO NOT return those as the model.
- Watch look-alike characters and decide by what is actually printed: 0 vs O, 1 vs I vs l, 5 vs S, 8 vs B, 2 vs Z, 6 vs G, D vs 0, U vs V, Q vs O. Trailing suffixes matter (…VA3, …0WW, …-01) — capture them.
- If ANY character is smudged, glare-washed, cut off, or ambiguous, set "confidence":"low" (don't hide the uncertainty).

CRITICAL RULES:
- Be conservative. If you can't clearly read the label + code, return "none". Better to miss than hallucinate a code that misroutes a return.
- For model stickers, the model_number must sit next to a "Model"/"MOD" label. A random alphanumeric isn't a model.
- For part stickers, the part_number must come from a labeled "Part" / "P/N" line. A generic number on a box isn't a part.
- Never return both bucket types simultaneously. One image, one kind.`;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return cors({ statusCode: 200, body: '' });
  if (event.httpMethod !== 'POST') return cors({ statusCode: 405, body: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return cors({ statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }); }

  const { job_id, image_url, tech_id, attachment_id } = body;
  if (!job_id || !image_url) {
    return cors({ statusCode: 400, body: JSON.stringify({ error: 'job_id + image_url required' }) });
  }

  // 1. Fetch the image and base64-encode it for the Anthropic API.
  let imgB64 = '';
  let mediaType = 'image/jpeg';
  try {
    const r = await fetch(image_url);
    if (!r.ok) throw new Error(`image fetch ${r.status}`);
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    mediaType = contentType.split(';')[0].trim();
    const arr = new Uint8Array(await r.arrayBuffer());
    imgB64 = Buffer.from(arr).toString('base64');
  } catch (err) {
    return cors({ statusCode: 502, body: JSON.stringify({ error: 'image fetch failed: ' + err.message }) });
  }

  // 2. Call Claude Vision (single round-trip classifier + extractor).
  let extracted;
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imgB64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok || !data.content) {
      throw new Error('claude api: ' + JSON.stringify(data).slice(0, 200));
    }
    const raw = String(data.content[0]?.text || '');
    const clean = raw.replace(/```json|```/g, '').trim();
    extracted = JSON.parse(clean);
  } catch (err) {
    return cors({ statusCode: 502, body: JSON.stringify({ error: 'vision failed: ' + err.message }) });
  }

  const kind = String(extracted?.kind || 'none');

  // 3. Route to the right write endpoint based on classification.
  let wrote = false;
  if (kind === 'model_sticker' && extracted.model_number) {
    try {
      const r = await fetch(`${XANO_BASE}/update_job_model_from_ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: Number(job_id),
          model_number: String(extracted.model_number).toUpperCase(),
          serial_number: String(extracted.serial_number || ''),
          manufacturer: String(extracted.manufacturer || ''),
          appliance_type: String(extracted.appliance_type || ''),
          confidence: String(extracted.confidence || 'medium'),
          image_url: String(image_url).slice(0, 400),
        }),
      });
      const wr = await r.json();
      wrote = !!(wr && wr.wrote);
    } catch (_) {}
  } else if (kind === 'part_sticker' && extracted.part_number) {
    try {
      const r = await fetch(`${XANO_BASE}/save_part_from_photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: Number(job_id),
          technician_id: tech_id ? Number(tech_id) : null,
          part_number: String(extracted.part_number).toUpperCase(),
          part_description: String(extracted.part_description || ''),
          manufacturer: String(extracted.manufacturer || ''),
          confidence: String(extracted.confidence || 'medium'),
          image_url: String(image_url).slice(0, 400),
          attachment_id: attachment_id ? Number(attachment_id) : null,
        }),
      });
      const wr = await r.json();
      wrote = !!(wr && wr.wrote);
    } catch (_) {}
  }

  return cors({
    statusCode: 200,
    body: JSON.stringify({ ...extracted, wrote }),
  });
};

function cors(resp) {
  return {
    ...resp,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(resp.headers || {}),
    },
  };
}
