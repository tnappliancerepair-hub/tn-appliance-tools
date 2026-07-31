// fitment-check — the customer-facing "will this part fit / which part do I need?"
// brain. The returns-killer behind the Amazon QR-in-box + the storefront "confirm
// it fits" widget. Fuses the pieces we already have (no parallel brain):
//   1. ocr-model-extract  — resolve the exact model/serial from a sticker photo
//   2. ant-brain-predict  — model+symptom -> failing part + confidence + seen_n + fault code
//   3. marcone-lookup     — live stock + supersession for the part (store mode)
// and returns a plain-English fitment VERDICT + evidence.
//
//   POST {
//     model?, brand?, appliance?, symptom?,   // typed path
//     part_number?,                            // "does THIS part fit my model?"
//     image_b64?, media_type?,                 // photo path (OCR the sticker)
//     mode?    // 'store' (default: show part# + stock + buy) | 'service' (confirm only, no part#)
//   }
//   -> { ok, machine, resolved_from, query_part, verdict, verdict_label,
//        recommended, alternates, fault_code, availability, evidence, needs_human }
'use strict';

// STATIC requires so Netlify/esbuild bundles the siblings into this function
// (a require(variable) is not statically analyzable and won't be bundled).
const brainPredict = require('./ant-brain-predict');
const ocrExtract = require('./ocr-model-extract');
const marconeLookup = require('./marcone-lookup');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function normAlnum(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function partKey(p) { return normAlnum(String(p || '').trim().split(/[\s(—-]/)[0]); }

// call a sibling function's handler in-process (like run-now) with graceful fallback
async function callFn(mod, body) {
  try {
    const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify(body), queryStringParameters: {} }, {});
    try { return JSON.parse(res.body); } catch (_) { return null; }
  } catch (_) { return null; }
}

// confidence may come back 0-1 or 0-100 — normalize to 0-100
function pct(v) { const n = Number(v || 0); return n <= 1 ? Math.round(n * 100) : Math.round(n); }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const mode = String(b.mode || 'store').toLowerCase();
  const store = mode !== 'service';

  // 1. resolve the machine — photo (OCR) wins, else typed
  let machine = { brand: b.brand || '', model: b.model || '', appliance: b.appliance || '', serial: '' };
  let resolvedFrom = 'typed';
  if (b.image_b64) {
    const ocr = await callFn(ocrExtract, { image_b64: b.image_b64, media_type: b.media_type || 'image/jpeg' });
    if (ocr && ocr.kind === 'model_sticker' && ocr.model_number) {
      machine = { brand: ocr.manufacturer || machine.brand, model: ocr.model_number, appliance: ocr.appliance_type || machine.appliance, serial: ocr.serial_number || '' };
      resolvedFrom = 'photo';
    } else if (ocr && ocr.kind === 'part_sticker' && ocr.part_number && !b.part_number) {
      b.part_number = ocr.part_number; // they snapped the part label -> verify THAT part
    }
  }

  if (!machine.model && !b.part_number) {
    return json(200, { ok: false, need: 'model_or_part', message: 'Enter your model number (or snap the model sticker), or a part number to check.' });
  }

  // 2. predict the failing part + fault code for this model+symptom
  const pred = machine.model ? await callFn(brainPredict, { brand: machine.brand, model: machine.model, appliance_type: machine.appliance, symptom: b.symptom || '' }) : null;
  const predictions = (pred && pred.ok && Array.isArray(pred.predictions)) ? pred.predictions : [];
  const basedOnN = (pred && pred.based_on_n) || 0;
  const top = predictions[0] || null;

  // 3. resolve the part in question: the one they're checking, else our top pick
  const queryPart = b.part_number ? String(b.part_number).trim() : (top ? String(top.part || '').split(/[\s(—-]/)[0] : '');

  // live availability + supersession (store mode only — never expose cost to service customers)
  let availability = null, supersededTo = null;
  if (store && queryPart) {
    const mk = await callFn(marconeLookup, { part_number: queryPart });
    const r = mk && mk.ok && Array.isArray(mk.results) ? mk.results[0] : null;
    if (r && r.found) {
      availability = { in_stock: !!r.in_stock, eta_days: r.eta_days, discontinued: !!r.discontinued };
      if (r.part_number && partKey(r.part_number) !== partKey(queryPart)) supersededTo = r.part_number; // Marcone resolved a superseding SKU
    }
  }

  // 4. verdict
  const knownForModel = queryPart && predictions.some((p) => partKey(p.part) === partKey(queryPart));
  const modelRecognized = basedOnN > 0;
  let verdict = 'verify', label = '';

  if (b.part_number) {
    // "does THIS part fit my model?"
    if (knownForModel) { verdict = 'confirmed'; label = `Confirmed — this part fits your ${machine.model} (we've used it on this exact model)`; }
    else if (availability && availability.discontinued) { verdict = 'verify'; label = `That part is discontinued${supersededTo ? ` — the current replacement is ${supersededTo}` : ''}. Let a tech confirm the right one.`; }
    else if (availability && !machine.model) { verdict = 'likely'; label = `That's a valid part — enter your model number so we can confirm it fits your exact machine.`; }
    else if (availability) { verdict = 'likely'; label = `Compatible per the catalog${supersededTo ? ` (current SKU: ${supersededTo})` : ''} — confirm your model/sub-variant to be 100% sure.`; }
    else { verdict = 'verify'; label = `We couldn't auto-confirm that part for your machine — a tech will verify it free.`; }
  } else if (top) {
    // "which part do I need?"
    const c = pct(top.confidence);
    if (modelRecognized && c >= 70 && (top.seen_n || 0) >= 3) { verdict = 'confirmed'; label = `For your ${machine.model}, this is the part — ${c}% confidence from ${top.seen_n} matching repairs.`; }
    else if (modelRecognized && c >= 40) { verdict = 'likely'; label = `Most likely the part for your ${machine.model} — confirm with a tech to be sure.`; }
    else { verdict = 'verify'; label = `We need a closer look — a tech will confirm the exact part free.`; }
  } else {
    verdict = 'verify'; label = `Thin data for that model — a tech will confirm the exact part free.`;
  }

  const needsHuman = verdict === 'verify';
  const evidence = basedOnN > 0 ? `Based on ${basedOnN} matching repair${basedOnN === 1 ? '' : 's'} in our history.` : `New model for us — human confirm keeps it accurate.`;

  // customer-safe recommended object (store shows the part#; service hides it)
  const recommended = top ? {
    component: top.component || '',
    part: store ? (top.part_display || top.part || '') : undefined,
    confidence: pct(top.confidence),
    seen_n: top.seen_n || 0,
  } : null;
  const alternates = store ? predictions.slice(1, 4).map((p) => ({ component: p.component, part: p.part_display || p.part, confidence: pct(p.confidence), seen_n: p.seen_n || 0 })) : [];

  return json(200, {
    ok: true, mode, machine, resolved_from: resolvedFrom,
    query_part: b.part_number ? queryPart : '',
    superseded_to: supersededTo,
    verdict, verdict_label: label,
    recommended, alternates,
    fault_code: (pred && pred.fault_code) || null,
    availability, evidence, needs_human: needsHuman,
    based_on_n: basedOnN,
  });
};
