// board-part-numbers — a per-job {part #, failed part} overlay for the office board,
// so the office SEES the part number right on the tile (no drawer click) when they
// submit the warranty report. Reads verified_part_number + failed_component straight
// off the TDR table (id 12) — the SAME reliable column the board + Ann use (NOT the
// flaky parts_needed). Newest TDR per job wins; blanks backfill from an older TDR.
// Self-contained (metadata API only) — no XS. (Teddy 2026-08-03: "the office needs the
// part number to show so they can easily submit a report — saves a few clicks.")
//
//   GET  ->  { ok, count, parts: { "<job_id>": { part, component } } }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TDR_TABLE = 12; // technician_decision_report
const PER = 500;
const MAX_PAGES = 4; // ~2000 most-recent TDRs — covers the jobs live on the board

function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function () {
  const map = {};
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let rows = [];
      try {
        const r = await fetch(`${META}/table/${TDR_TABLE}/content/search`, {
          method: 'POST', headers: authH(),
          body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page }),
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) break;
        rows = (await r.json()).items || [];
      } catch (_) { break; }
      if (!rows.length) break;
      for (const t of rows) {
        const jid = Number(t.job_id || 0);
        if (!jid) continue;
        const part = String(t.verified_part_number || '').trim();
        const comp = String(t.failed_component || '').trim();
        if (!part && !comp) continue;
        // rows are id-desc → the first time we see a job is its newest TDR (wins);
        // a later (older) TDR only fills a field the newest one left blank.
        if (map[jid] === undefined) map[jid] = { part, component: comp };
        else {
          if (!map[jid].part && part) map[jid].part = part;
          if (!map[jid].component && comp) map[jid].component = comp;
        }
      }
      if (rows.length < PER) break;
    }
  } catch (_) {}
  return j(200, { ok: true, count: Object.keys(map).length, parts: map });
};
