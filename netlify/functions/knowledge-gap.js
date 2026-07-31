// knowledge-gap — the "every I-don't-know becomes a permanent now-I-know" ledger.
// Part of the Knowledge Engine (goal: the most advanced troubleshooting brain in
// appliance repair). Whenever the diagnostic brain can't confidently answer — an
// unknown fault code, or a model/symptom it had no grounding for — it records a
// gap here. A gap that recurs rises to the top so it gets filled first. Filling a
// gap (add the code/tech-sheet/component) logs a "filled" marker so it drops off.
//
//   POST { kind, brand, appliance, code?, model?, symptom?, role? }   record a gap
//   GET  ?secret=<admin>[&days=30]        list OPEN gaps, most-frequent first
//   GET  ?secret=<admin>&fill=<key>       mark a gap key filled (drops it from open)
//   GET  ?secret=<admin>&stats=1          open count + filled-today (for the scorecard)
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(r) { return Number(metaOf(r).at_ms) || Date.parse(r && r.created_at) || 0; }
const norm = (s) => String(s || '').toLowerCase().trim();

// A gap's identity: a fault-code gap is brand|appliance|code; otherwise brand|appliance|model.
function keyOf(m) {
  const b = norm(m.brand) || '?', a = norm(m.appliance) || '?';
  if (m.code) return `code|${b}|${a}|${norm(m.code).replace(/[\s\-_.]/g, '')}`;
  if (m.model) return `model|${b}|${a}|${norm(m.model)}`;
  return `sym|${b}|${a}|${norm(m.symptom).slice(0, 40)}`;
}

function isoDateCT(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // Record a gap — public (the brain calls it in-process; also fine over HTTP).
  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    if (!b.brand && !b.code && !b.model) return json(400, { ok: false, error: 'need at least brand+code or brand+model' });
    const meta = {
      kind: String(b.kind || (b.code ? 'fault_code' : 'model')).slice(0, 24),
      brand: String(b.brand || '').slice(0, 40), appliance: String(b.appliance || '').slice(0, 24),
      code: String(b.code || '').slice(0, 24), model: String(b.model || '').slice(0, 60),
      symptom: String(b.symptom || '').slice(0, 160), role: String(b.role || '').slice(0, 16),
      at_ms: Date.now(),
    };
    meta.key = keyOf(meta);
    try { await crud.logEvent('knowledge_gap', meta); } catch (_) {}
    return json(200, { ok: true, key: meta.key });
  }

  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  if (q.fill) {
    try { await crud.logEvent('knowledge_gap_filled', { key: String(q.fill), at_ms: Date.now() }); } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
    return json(200, { ok: true, filled: String(q.fill) });
  }

  const days = Math.max(1, Math.min(120, parseInt(q.days, 10) || 45));
  const since = Date.now() - days * 86400000;
  let gaps = [], fills = [];
  try {
    gaps = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_gap' }, { id: 'desc' }, 500);
    fills = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_gap_filled' }, { id: 'desc' }, 500);
  } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }

  // newest fill per key
  const filledAt = {};
  for (const r of fills) { const m = metaOf(r); const t = tsOf(r); if (m.key && t >= (filledAt[m.key] || 0)) filledAt[m.key] = t; }

  // aggregate open gaps by key
  const agg = {};
  for (const r of gaps) {
    const m = metaOf(r); const t = tsOf(r); if (t < since) continue;
    const k = m.key || keyOf(m); if (!k) continue;
    if (filledAt[k] && filledAt[k] >= t) continue; // filled after this sighting -> resolved
    const a = agg[k] || (agg[k] = { key: k, kind: m.kind, brand: m.brand, appliance: m.appliance, code: m.code, model: m.model, symptom: m.symptom, count: 0, last_seen: 0 });
    a.count++; if (t > a.last_seen) a.last_seen = t;
  }
  const open = Object.values(agg).sort((x, y) => y.count - x.count || y.last_seen - x.last_seen);

  if (q.stats === '1') {
    const today = isoDateCT(Date.now());
    const filledToday = fills.filter((r) => isoDateCT(tsOf(r)) === today).length;
    return json(200, { ok: true, open_gaps: open.length, top: open.slice(0, 5), filled_today: filledToday });
  }
  return json(200, { ok: true, days, open_gaps: open.length, gaps: open.slice(0, 60) });
};
