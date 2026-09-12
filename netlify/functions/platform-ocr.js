// platform-ocr — read the model/serial off a photo of the appliance sticker (Claude
// Vision), for the platform tech job page. The tech snaps the sticker, this returns the
// model # so it auto-fills the report (and the brain keys on brand+model). Mirrors TN's
// ocr-model-extract but tenant-agnostic: it just extracts + returns; the page saves it.
//
//   POST { data: "data:image/jpeg;base64,..." }               -> { ok, kind:'model', model, brand, serial, appliance }
//   POST { data: "...", mode:'part' }  (warranty part return)  -> { ok, kind:'part', part_number, part_description, brand }
//   POST { data: "...", mode:'receipt' } (a part the tech BOUGHT)   -> { ok, kind:'receipt', store, cost_cents, multi_item, part_number, ... }
'use strict';

const { getSecret } = require('./_lib/secrets');
const MODEL = 'claude-sonnet-5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

const PROMPT = 'This is a photo a technician took of an appliance data/model sticker. ' +
  'Read it and return ONLY compact JSON: {"model_number":"","serial_number":"","manufacturer":"","appliance_type":"","confidence":"high|medium|low"}. ' +
  'model_number is the MODEL (not serial). If you cannot find a clear model number, set model_number to "" and confidence "low". No prose, JSON only.';

// Part-return mode: the tech snaps a photo of a warranty part / its box to log a return.
// Read the PART number off the component label / box (lifted from TN's ocr-model-extract
// part-sticker rules). Never guess — a wrong part # misroutes a return.

// Receipt mode: the tech bought a part at a parts house / big-box store and snapped the
// receipt. We want the STORE and the part's own line total -- not the order total, because a
// tech often buys more than one thing on one trip and only some of it belongs to this job.
// Money is being read here, so a doubtful read must come back low-confidence rather than
// confidently wrong: a bad cost silently becomes a bad customer price and a bad reimbursement.
const RECEIPT_PROMPT = 'This is a photo of a store receipt a repair technician took after buying an appliance part. ' +
  'Return ONLY compact JSON: ' +
  '{"store":"","purchased_on":"","part_total":"","order_total":"","part_number":"","part_description":"","confidence":"high|medium|low"}. ' +
  'store = the business name printed on the receipt (e.g. "The Home Depot", "Marcone", "Reliable Parts"). ' +
  'part_total = the price of the APPLIANCE PART line only, as a plain number like 48.97, with no currency symbol. ' +
  'order_total = the receipt GRAND TOTAL as a plain number. If only one item was purchased these are the same. ' +
  'purchased_on = the date on the receipt as YYYY-MM-DD if legible, else "". ' +
  'part_number / part_description = the part identifier and item name if the receipt shows them, else "". ' +
  'If the receipt is blurry, cut off, or you are unsure of any amount, set that field to "" and confidence "low". ' +
  'NEVER guess an amount. No prose, JSON only.';

const PART_PROMPT = 'This is a photo a technician took of an appliance PART (a component like a drive belt, ' +
  'control board, water valve, pump, motor, capacitor, switch — or its box/label), to log it as a warranty return. ' +
  'Read the PART NUMBER (labeled "Part" / "P/N" / "Part No." / "Part #" — an alphanumeric code like 8540101, WPW10730972, W11315838) and return ONLY compact JSON: ' +
  '{"part_number":"","part_description":"","manufacturer":"","confidence":"high|medium|low"}. ' +
  'Transcribe the code EXACTLY as printed, character by character — do NOT normalize, complete, or guess it. ' +
  'Watch look-alikes (0/O, 1/I/l, 5/S, 8/B, 2/Z, 6/G) and capture trailing suffixes (…-01). ' +
  'If ANY character is smudged/glare/cut-off/ambiguous, set confidence "low". If you cannot read a clear part number, set part_number "" and confidence "low". No prose, JSON only.';

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

  const mode = String(b.mode || b.kind || '').toLowerCase();
  const partMode = mode === 'part';
  const receiptMode = mode === 'receipt';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imgB64 } },
          { type: 'text', text: receiptMode ? RECEIPT_PROMPT : (partMode ? PART_PROMPT : PROMPT) },
        ] }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    const d = await r.json();
    if (!r.ok || !d.content) return json(200, { ok: false, error: 'vision: ' + JSON.stringify(d).slice(0, 160) });
    const raw = String((d.content[0] && d.content[0].text) || '').replace(/```json|```/g, '').trim();
    let ex = {}; try { ex = JSON.parse(raw); } catch (_) { return json(200, { ok: false, error: receiptMode ? 'could not read the receipt' : (partMode ? 'could not read the part' : 'could not read the sticker') }); }
    if (receiptMode) {
      // Money: parse to CENTS here so no caller re-implements it, and never accept a negative
      // or absurd amount from a misread. Prefer the part's own line over the order total --
      // a tech often buys several things on one trip and only some belongs to this job.
      const money = (v) => {
        const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
        if (!isFinite(n) || n <= 0 || n > 100000) return null;
        return Math.round(n * 100);
      };
      const partC = money(ex.part_total), orderC = money(ex.order_total);
      return json(200, {
        ok: true, kind: 'receipt',
        store: String(ex.store || '').trim(),
        purchased_on: String(ex.purchased_on || '').trim(),
        cost_cents: partC != null ? partC : orderC,
        part_total_cents: partC, order_total_cents: orderC,
        // true when the receipt covers more than this one part, so the caller can ask a human
        // instead of quietly billing the whole trip to one job.
        multi_item: (partC != null && orderC != null && orderC > partC),
        part_number: String(ex.part_number || '').toUpperCase().trim(),
        part_description: String(ex.part_description || '').trim(),
        confidence: String(ex.confidence || 'medium'),
      });
    }
    if (partMode) {
      return json(200, {
        ok: true, kind: 'part',
        part_number: String(ex.part_number || '').toUpperCase().trim(),
        part_description: String(ex.part_description || '').trim(),
        brand: String(ex.manufacturer || '').trim(),
        confidence: String(ex.confidence || 'medium'),
      });
    }
    return json(200, {
      ok: true, kind: 'model',
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
