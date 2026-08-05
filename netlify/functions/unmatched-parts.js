// unmatched-parts — the safety net for supplied-parts emails that couldn't be tied to
// a job. The parts watchers (servicepower-parts-watch / ahs-parts-watch) now record a
// `warranty_part_unmatched` event instead of silently dropping a part they can't match.
// This lists the open ones for the office and lets them LINK one to a job in a tap —
// which records it as a supplied part (so it lands on the tile) and clears it here.
// Nothing sent to us ever vanishes. (Teddy 2026-08-04: "still missing sometimes.")
//
//   GET  ?secret=<admin>                    → { ok, count, items:[...] }  (open, newest first)
//   POST {secret, key, job_id, by?}         → link it to a job; records supplied + resolves
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const j = (c, b) => ({ statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) });
const meta = (r) => { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; };
const normP = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Stable key so a resolved item stays resolved and the list dedupes across re-records.
const keyOf = (m) => `${m.vendor || ''}::${m.call || m.claim || ''}::${normP(m.part)}`;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let body = {}; if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch (_) {} }
  if (q.secret !== admin && body.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });

  if (event.httpMethod === 'POST') {
    const jobId = Number(body.job_id || 0);
    const key = String(body.key || '');
    if (!jobId || !key) return j(400, { ok: false, error: 'key + job_id required' });
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'warranty_part_unmatched' }, { id: 'desc' }, 1000).catch(() => []);
    const hit = (rows || []).map(meta).find((m) => keyOf(m) === key);
    if (!hit) return j(404, { ok: false, error: 'unmatched item not found' });
    // Record it as a supplied part on the chosen job → it shows on the tech's tile, and
    // once the tech marks it Unused, the returns loader auto-links its label.
    try {
      await crud.logEvent('warranty_part_supplied', {
        job_id: jobId, claim: hit.claim || hit.call || '', part: hit.part || '', description: hit.description || '',
        qty: hit.qty || 1, distributor: hit.distributor || '', vendor: hit.vendor || '', tracking: hit.tracking || '',
        requires_return: !!hit.requires_return, status: 'requested', source: 'office_link_unmatched', at_ms: Date.now(),
      });
    } catch (e) { return j(200, { ok: false, error: 'could not record supplied part: ' + String(e.message || e) }); }
    if (hit.eta) { try { await crud.update(crud.TABLES.jobs, jobId, { parts_status: 'awaiting_parts', parts_eta_date: hit.eta }); } catch (_) {} }
    try { await crud.logEvent('warranty_part_unmatched_resolved', { key, job_id: jobId, part: hit.part || '', by: String(body.by || 'office'), at_ms: Date.now() }); } catch (_) {}
    return j(200, { ok: true, linked: true, job_id: jobId, part: hit.part || '' });
  }

  // GET — open unmatched (newest per key, minus resolved).
  const [rows, resolved] = await Promise.all([
    crud.searchPage(crud.TABLES.event_log, { action: 'warranty_part_unmatched' }, { id: 'desc' }, 1000).catch(() => []),
    crud.searchPage(crud.TABLES.event_log, { action: 'warranty_part_unmatched_resolved' }, { id: 'desc' }, 1000).catch(() => []),
  ]);
  const done = new Set((resolved || []).map((r) => String(meta(r).key || '')));
  const seen = new Set(); const items = [];
  for (const r of rows || []) {
    const m = meta(r); const k = keyOf(m);
    if (!m.part && !m.call && !m.claim) continue;
    if (seen.has(k) || done.has(k)) continue; seen.add(k);
    items.push({
      key: k, vendor: m.vendor || '', call: m.call || m.claim || '', part: m.part || '', description: m.description || '',
      distributor: m.distributor || '', tracking: m.tracking || '', eta: m.eta || '', qty: m.qty || 1,
      at_ms: Number(m.at_ms || r.created_at || 0), msg_id: m.msg_id || '',
    });
  }
  items.sort((a, b) => b.at_ms - a.at_ms);
  return j(200, { ok: true, count: items.length, items });
};
