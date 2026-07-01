// tech-call-review — office-gated read of recent tech↔Ant voice sessions (Ant
// Field Assist) with transcripts, so we can skim them and catch where Ant went
// sideways (e.g. suggesting a compressor on a washer). Uses VAPI_PRIVATE_KEY
// server-side — the browser never sees the Vapi key or the admin secret.
//
//   POST { password, limit?, assistant_id? } -> { ok, calls:[{ id, started_ct,
//          duration_s, phone, ended_reason, summary, transcript, flags:[...] }] }
'use strict';
const { getSecret } = require('./_lib/secrets');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const VAPI = 'https://api.vapi.ai';
const FIELD_ASSIST = 'a22edcd1-495a-4d77-a66a-fb167997c70a'; // Ant Field Assist
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

async function officeOk(pw) {
  try {
    const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const d = await r.json().catch(() => ({}));
    return !!(d && d.success === true);
  } catch (_) { return false; }
}

// Cheap heuristics for "Ant may have gone sideways" so the reviewer's eye goes
// straight to the risky sessions. Not a verdict — just a highlighter.
const REFRIG_RE = /\b(compressor|refrigerant|freon|sealed system|evaporator|condenser)\b/i;
const LAUNDRY_COOK_RE = /\b(washer|dryer|dishwasher|oven|range|stove|cooktop|microwave)\b/i;
const FRUSTRATION_RE = /\b(no,? that'?s not|you'?re not (getting|understanding)|i (already )?(said|told you)|that'?s wrong|not what i|listen|are you (even )?listening|forget it|never ?mind|ugh)\b/i;
const CONFUSION_RE = /\b(i (don'?t|do not) (know|understand|recognize)|i'?m not sure|can'?t tell|no grounding|not sure what)\b/i;
function flagsFor(transcript) {
  const t = String(transcript || '');
  const out = [];
  // wrong-appliance: refrigeration part named while the unit is laundry/cooking
  if (REFRIG_RE.test(t) && LAUNDRY_COOK_RE.test(t) && !/\b(refrigerat|fridge|freezer)\b/i.test(t)) out.push('possible wrong-appliance part (refrigeration term on a non-fridge)');
  if (FRUSTRATION_RE.test(t)) out.push('tech sounds frustrated');
  if (CONFUSION_RE.test(t)) out.push('Ant unsure / thin grounding');
  return out;
}

exports.config = { timeout: 24 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  if (!(await officeOk(b.password))) return json(200, { ok: false, error: 'unauthorized' });

  const key = await getSecret('VAPI_PRIVATE_KEY');
  if (!key) return json(200, { ok: false, error: 'VAPI_PRIVATE_KEY not configured' });
  const id = String(b.assistant_id || FIELD_ASSIST).trim();
  const limit = Math.min(Math.max(Number(b.limit) || 25, 1), 100);

  let arr = [];
  try {
    const r = await fetch(`${VAPI}/call?assistantId=${encodeURIComponent(id)}&limit=${limit}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => ([]));
    arr = Array.isArray(d) ? d : (d.results || d.calls || []);
  } catch (e) { return json(200, { ok: false, error: 'vapi call list failed: ' + String((e && e.message) || e) }); }

  const calls = arr.map((c) => {
    const started = c.startedAt || c.createdAt || null;
    const ended = c.endedAt || null;
    const dur = (started && ended) ? Math.round((new Date(ended) - new Date(started)) / 1000) : null;
    const transcript = c.transcript || (c.artifact && c.artifact.transcript) || '';
    return {
      id: c.id,
      started_ct: started ? new Date(started).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : '',
      started_ms: started ? new Date(started).getTime() : 0,
      duration_s: dur,
      phone: (c.customer && c.customer.number) || '',
      ended_reason: c.endedReason || '',
      summary: (c.analysis && c.analysis.summary) || c.summary || '',
      transcript,
      flags: flagsFor(transcript),
    };
  }).sort((a, b2) => b2.started_ms - a.started_ms);

  return json(200, { ok: true, count: calls.length, calls });
};
