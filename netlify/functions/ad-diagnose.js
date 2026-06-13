// Consumer "free AI diagnosis" behind the Cybertruck QR (truck.html) — and the
// seed of the consumer platform. Takes a photo + a sentence, returns a friendly
// Claude-vision diagnosis + DIY-vs-pro guidance, and logs the lead tagged with
// its source so we can measure what the truck (or any ad) is worth.
//
// POST { mode:'scan'|'diagnose', src, appliance, problem, image_data_url?, contact? }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
async function logRow(action, metadata) {
  const h = headers(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action, metadata }) }); } catch (_) {}
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const src = String(b.src || 'web').slice(0, 40);

  // Scan beacon — just count the QR scan / page open.
  if (b.mode === 'scan') {
    await logRow('ad_scan', { src, at_ms: Date.now() });
    return jsonResp(200, { ok: true, logged: 'scan' });
  }

  const appliance = String(b.appliance || '').slice(0, 60);
  const problem = String(b.problem || '').slice(0, 800);
  const contact = String(b.contact || '').slice(0, 40);
  const img = String(b.image_data_url || '');

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return jsonResp(200, { ok: false, error: 'diagnosis_unavailable' });

  const sys =
    "You are Ant, TN Appliance Exchange's friendly appliance expert. A homeowner sent a photo and/or a quick description of an appliance problem. " +
    "Give a warm, plain-English best-guess: what's likely going on, and whether it's a safe DIY or a call-a-pro job. " +
    "HARD SAFETY RULE: anything involving gas, 240V wiring, refrigerant/sealed systems, or water-heater internals = tell them NOT to DIY and to have a pro handle it. Never give risky steps. Never invent part numbers. " +
    "Format: 2-4 short sentences. End with one honest line on next step. Be encouraging, not alarming.";

  const content = [];
  if (img && img.indexOf('base64,') > -1) {
    const meta = img.substring(5, img.indexOf(';'));
    const data = img.substring(img.indexOf('base64,') + 7);
    if (data && data.length < 6000000) content.push({ type: 'image', source: { type: 'base64', media_type: meta || 'image/jpeg', data } });
  }
  content.push({ type: 'text', text: ('Appliance: ' + (appliance || 'unknown') + '\nProblem: ' + (problem || '(see photo)')) });

  let diagnosis = '';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 500, system: sys, messages: [{ role: 'user', content }] }),
    });
    const d = await r.json();
    diagnosis = (d && d.content && d.content[0] && d.content[0].text) ? String(d.content[0].text).trim() : '';
  } catch (_) {}

  await logRow('ad_lead', {
    src, appliance, problem: problem.slice(0, 240), contact,
    had_photo: !!content.find((c) => c.type === 'image'),
    diagnosis: diagnosis.slice(0, 400), at_ms: Date.now(),
  });

  if (!diagnosis) return jsonResp(200, { ok: false, error: 'diagnosis_unavailable' });
  return jsonResp(200, { ok: true, diagnosis });
};
