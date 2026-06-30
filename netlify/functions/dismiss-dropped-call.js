// dismiss-dropped-call — lets the office clear a resolved dropped/dead-air call
// off the callbacks board with an X. Persists via an event_log breadcrumb (no
// Mac/XS push). Dismissal is per-phone + timestamped, so a card stays cleared —
// but REAPPEARS automatically if that number calls and drops again after the
// dismiss (the board compares the latest drop time to the dismiss time).
//
//   POST { phone }   -> record a dismissal (now)
//   GET              -> { ok, dismissed: { "<phone10>": <dismissed_at_ms> } } (last 7d)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const EVENT_LOG = crud.TABLES.event_log;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' }, body: JSON.stringify(b) }; }
const p10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' }, body: '' };

  if (event.httpMethod === 'POST') {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    const phone = p10(b.phone);
    if (phone.length !== 10) return j(400, { ok: false, error: 'valid phone required' });
    try { await crud.logEvent('dropped_call_dismissed', { phone, at_ms: Date.now(), by: 'office' }); }
    catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
    return j(200, { ok: true, phone });
  }

  // GET — latest dismissal per phone in the last 7 days
  const cutoff = Date.now() - 7 * 86400000;
  const dismissed = {};
  try {
    const rows = await crud.searchPage(EVENT_LOG, { action: 'dropped_call_dismissed' }, { created_at: 'desc' }, 400);
    for (const r of rows) {
      let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
      const ph = p10(m && m.phone); const at = Number(m && m.at_ms) || (r.created_at ? new Date(r.created_at).getTime() : 0);
      if (ph.length === 10 && at >= cutoff && (dismissed[ph] == null || at > dismissed[ph])) dismissed[ph] = at;
    }
  } catch (_) {}
  return j(200, { ok: true, dismissed });
};
