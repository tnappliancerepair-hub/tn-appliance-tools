// Vision OCR — extract appliance model/serial/brand from a photo.
//
// Called by tech-simple after a photo upload completes. If the photo is
// a model sticker, returns structured fields AND writes job.model_number
// (only if currently empty — never overwrites tech's manual entry).
//
// If the photo is NOT a sticker (room, appliance front, person, food,
// error code display, part sticker), returns {is_model_sticker: false}
// and writes nothing. Conservative classifier — better to miss than
// pollute job data with garbage.
//
// Request:  POST { job_id, image_url }
// Response: { is_model_sticker, model_number?, serial_number?,
//             manufacturer?, appliance_type?, confidence?, wrote: bool }

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

const PROMPT = `You're an expert at reading appliance model stickers (the manufacturer's nameplate on washers, dryers, refrigerators, dishwashers, ranges, microwaves, HVAC units).

Look at this image carefully.

If this is CLEARLY an appliance MODEL STICKER — you can see the word "Model" / "Model #" / "Model No." or similar, AND an alphanumeric model code like WTW5000DW2, GTW465ASN0WW, RF28HFEDBSR, etc. — extract:
- model_number: the exact model code, UPPERCASE, no spaces
- serial_number: the serial number if visible, else ""
- manufacturer: brand (Whirlpool, Samsung, GE, LG, Maytag, Kenmore, Frigidaire, KitchenAid, Bosch, Amana, etc.)
- appliance_type: best guess of category (washer, dryer, refrigerator, dishwasher, range, oven, microwave, hvac, other)
- confidence: "high" if all fields are crystal clear, "medium" if some uncertainty, "low" if you're unsure

Return strict JSON:
{"is_model_sticker": true, "model_number": "...", "serial_number": "...", "manufacturer": "...", "appliance_type": "...", "confidence": "..."}

If this is NOT a model sticker (it's an appliance front, room photo, person, food, error code display, a part sticker for a single component, a generic object, anything other than a manufacturer's full nameplate), return:
{"is_model_sticker": false}

CRITICAL: Be conservative. If you can't clearly read "Model" label + alphanumeric code, return false. Better to miss a real sticker than guess wrong.`;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return cors({ statusCode: 200, body: '' });
  }
  if (event.httpMethod !== 'POST') {
    return cors({ statusCode: 405, body: 'Method Not Allowed' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return cors({ statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }); }

  const { job_id, image_url } = body;
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

  // 2. Call Claude Vision.
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

  // 3. If sticker found, write back to Xano (only updates if model_number
  //    is currently empty — preserves manual entry).
  let wrote = false;
  if (extracted && extracted.is_model_sticker === true && extracted.model_number) {
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
    } catch (_) {
      // soft fail — return extraction anyway so client can show what was found
    }
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
