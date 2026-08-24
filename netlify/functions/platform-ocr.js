// platform-ocr — read the model/serial off a photo of the appliance sticker (Claude
// Vision), for the platform tech job page. The tech snaps the sticker, this returns the
// model # so it auto-fills the report (and the brain keys on brand+model). Mirrors TN's
// ocr-model-extract but tenant-agnostic: it just extracts + returns; the page saves it.
//
//   POST { data: "data:image/jpeg;base64,..." }  ->  { ok, model, brand, serial, appliance }
'use strict';

const { getSecret } = require('./_lib/secrets');
const MODEL = 'claude-sonnet-5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

const PROMPT = 'This is a photo a technician took of an appliance data/model sticker. ' +
  'Read it and return ONLY compact JSON: {"model_number":"","serial_number":"","manufacturer":"","appliance_type":"","confidence":"high|medium|low"}. ' +
  'model_number is the MODEL (not serial). If you cannot find a clear model number, set model_number to "" and confidence "low". No prose, JSON only.';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  let mediaType = '', imgB64 = '';
  const m = String(b.data || '').match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (m) { mediaType = m[1]; imgB64 = m[2]; }
  else if (b.url) {
    // fetch the (public) photo server-side and base64 it — lets the page auto-read the
    // model off the customer's intake sticker photo without CORS.
    try {
      const r = await fetch(String(b.url), { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return json(200, { ok: false, error: 'photo_fetch_failed' });
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (!/^image\//.test(ct)) return json(200, { ok: false, error: 'not_an_image' });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) return json(200, { ok: false, error: 'image_too_large' });
      mediaType = ct.split(';')[0]; imgB64 = buf.toString('base64');
    } catch (_) { return json(200, { ok: false, error: 'photo_fetch_failed' }); }
  }
  if (!imgB64) return json(400, { ok: false, error: 'send a base64 image in "data" or a photo "url"' });

  const key = process.env.ANTHROPIC_API_KEY || (await getSecret('ANTHROPIC_API_KEY'));
  if (!key) return json(200, { ok: false, error: 'ocr_not_configured' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imgB64 } },
          { type: 'text', text: PROMPT },
        ] }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    const d = await r.json();
    if (!r.ok || !d.content) return json(200, { ok: false, error: 'vision: ' + JSON.stringify(d).slice(0, 160) });
    const raw = String((d.content[0] && d.content[0].text) || '').replace(/```json|```/g, '').trim();
    let ex = {}; try { ex = JSON.parse(raw); } catch (_) { return json(200, { ok: false, error: 'could not read the sticker' }); }
    return json(200, {
      ok: true,
      model: String(ex.model_number || '').toUpperCase().trim(),
      serial: String(ex.serial_number || '').trim(),
      brand: String(ex.manufacturer || '').trim(),
      appliance: String(ex.appliance_type || '').trim(),
      confidence: String(ex.confidence || 'medium'),
    });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 160) });
  }
};
