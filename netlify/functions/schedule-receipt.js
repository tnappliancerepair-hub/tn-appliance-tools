// schedule-receipt — the shared, timestamped record of who scheduled what, and
// whether it was CONFIRMED saved (Teddy 2026-07-17, the trust fix). Danielle's
// scheduling screen writes one of these after every save it has VERIFIED landed on
// the server; the office sees "✓ Saved", and the TECH sees "Scheduled by Danielle ·
// Thu 10:33am" on his job — so "did she put it in or not?" is settled by a record
// both sides can see, not a he-said-she-said. Ends the trust gap that keeps everyone
// on the old system.
//
//   POST { job_id, actor, tech_id?, day?, confirmed }  -> logs schedule_receipt
//   GET                                                 -> latest CONFIRMED receipt per job (recent)
//   GET ?job_id=N                                       -> latest receipt for one job
'use strict';
const crud = require('./_lib/xano/metadata-crud');

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'bad_json' }); }
    const jobId = Number(b.job_id || 0);
    if (!jobId) return j(400, { ok: false, error: 'job_id required' });
    try {
      await crud.logEvent('schedule_receipt', {
        job_id: jobId,
        actor: String(b.actor || 'office').slice(0, 40),
        tech_id: Number(b.tech_id || 0),
        day: String(b.day || '').slice(0, 20),
        confirmed: !!b.confirmed,
        at_ms: Date.now(),
      });
    } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
    return j(200, { ok: true });
  }

  // GET — read receipts (latest per job).
  const p = event.queryStringParameters || {};
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'schedule_receipt' }, { id: 'desc' }, 1500);
    if (p.job_id) {
      const want = String(Number(p.job_id));
      for (const r of rows) { const m = metaOf(r); if (String(m.job_id) === want) return j(200, { ok: true, receipt: { job_id: Number(m.job_id), actor: m.actor || '', tech_id: Number(m.tech_id || 0), day: m.day || '', confirmed: !!m.confirmed, at: Number(m.at_ms) || Number(r.created_at) || 0 } }); }
      return j(200, { ok: true, receipt: null });
    }
    // latest CONFIRMED receipt per job (what the tech side surfaces)
    const seen = {}, out = [];
    for (const r of rows) {
      const m = metaOf(r); const jid = Number(m.job_id || 0);
      if (!jid || seen[jid]) continue; seen[jid] = 1;
      if (!m.confirmed) continue;               // only surface confirmed saves to the tech
      out.push({ job_id: jid, actor: m.actor || '', day: m.day || '', at: Number(m.at_ms) || Number(r.created_at) || 0 });
    }
    return j(200, { ok: true, receipts: out });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e), receipts: [] });
  }
};
