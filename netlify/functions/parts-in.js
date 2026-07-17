// parts-in — feeds the office board's green→red "📦 PART IN — SCHEDULE NOW"
// ribbon. Returns every job that has a part_arrived_ready flag (written by
// _lib/part-notify.notifyPartArrived the moment a part lands — via a delivery
// email, the customer texting "it's here", or a call). One entry per job with
// its arrived_at so the board can age the ribbon green→amber→red. The board
// decides which are still "hot" (not yet scheduled) and clears them itself.
'use strict';
const crud = require('./_lib/xano/metadata-crud');

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function () {
  try {
    // newest-first; one flag per job (notifyPartArrived writes it once), take the first seen.
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'part_arrived_ready' }, { id: 'desc' }, 500);
    const seen = {}, out = [];
    for (const r of rows) {
      const m = metaOf(r);
      const jid = Number(m.job_id || 0);
      if (!jid || seen[jid]) continue;
      seen[jid] = 1;
      out.push({ job_id: jid, arrived_at: Number(m.arrived_at) || Number(r.created_at) || 0 });
    }
    return j(200, { ok: true, parts_in: out });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e), parts_in: [] });
  }
};
