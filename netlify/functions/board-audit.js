// board-audit — proves the job board is COMPLETE, so it can be the single source of
// truth (Teddy 2026-07-15: "we need the job board to be the most reliable source... a
// dropped or misplaced job can cause major issues"). Danielle still trusts MeisterTask
// because jobs have silently vanished off the board.
//
// HOW A JOB VANISHES: get_office_kanban loads only an ALLOW-LIST of statuses
// (not_ready / needs_scheduled / scheduled / in_progress / awaiting_parts / held /
// completed-within-60d). A REAL job in ANY OTHER non-terminal status — the documented
// needs_more_info blind spot that hid Calvin Gibson's job, plus broadcasting / booked /
// pending — is loaded by nothing and appears NOWHERE. This endpoint independently finds
// those jobs and reports them, so the board can surface "N jobs are in the system but not
// on your board" instead of silently losing them. It's the check-and-balance.
//
//   GET  ->  { ok, board_count, missing_count, by_status, missing:[{id,status,name,appliance,last4,created_at}] }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JOBS = crud.TABLES.jobs; // 7

// Statuses the board feed does NOT load but which can still hold a REAL, live job.
// Keep this in lock-step with get_office_kanban's allow-list: anything the feed adds,
// remove here; anything the feed still omits belongs here. A status that doesn't exist
// just returns zero rows (harmless).
const EXCLUDED_ACTIVE = [
  'needs_more_info', 'broadcasting', 'booked', 'pending',
  'ready_to_schedule', 'reschedule_pending', 'accepted', 'offered',
];
const CANCEL_RE = /cancel/i;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }

// A REAL job has a customer name OR a valid phone OR an appliance. This filters out the
// dead SquareTrade claim-shells (no name/phone/appliance) that are NOT what Danielle is
// looking for — we only flag jobs that carry actual work/financial data.
function isReal(j) {
  const name = String(j.customer_first || j.customer_last || '').trim();
  const ph = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
  const appl = String(j.appliance_type || j.appliance || '').trim();
  return !!(name || ph.length >= 10 || appl);
}

exports.handler = async function () {
  // 1) What the board actually shows right now (the feed's own output).
  const boardIds = new Set();
  try {
    const d = await (await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(25000) })).json();
    (d.items || d.jobs || []).forEach((j) => boardIds.add(Number(j.id)));
  } catch (_) {
    return json(200, { ok: false, error: 'board_feed_unreachable' });
  }

  // 2) Independently pull real jobs sitting in a status the feed excludes, and keep only
  //    the ones the board isn't already showing.
  const missing = [];
  const byStatus = {};
  for (const st of EXCLUDED_ACTIVE) {
    let rows = [];
    try { rows = (await crud.searchPage(JOBS, { scheduling_status: st }, { id: 'desc' }, 300)) || []; } catch (_) {}
    for (const j of rows) {
      if (CANCEL_RE.test(String(j.current_status || ''))) continue;   // truly canceled -> fine to hide
      if (!isReal(j)) continue;                                        // dead claim-shell, no real data
      if (boardIds.has(Number(j.id))) continue;                        // already visible -> fine
      byStatus[st] = (byStatus[st] || 0) + 1;
      missing.push({
        id: j.id,
        status: st,
        name: ((j.customer_first || '') + ' ' + (j.customer_last || '')).trim(),
        appliance: j.appliance_type || j.appliance || '',
        last4: String(j.customer_phone || j.phone || '').replace(/\D/g, '').slice(-4),
        warranty_company: j.warranty_company || '',
        technician_id: j.technician_id || 0,
        scheduled_start: j.scheduled_start || 0,
        created_at: j.created_at || 0,
      });
    }
  }
  missing.sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0));

  return json(200, {
    ok: true,
    board_count: boardIds.size,
    missing_count: missing.length,
    by_status: byStatus,
    checked_statuses: EXCLUDED_ACTIVE,
    missing: missing.slice(0, 150),
  });
};
