// part-recovery-cron — stop-the-bleeding safety net for the recurring "part number
// disappeared" bug (Teddy 2026-08-13, from Jimmy: "I put the part in but there's no
// history / can't find the part numbers"). Some TDR write paths still land the part # in
// the parts_needed LIST column, which the office board can't read, so it silently drops.
// backfill-part-numbers recovers those into verified_part_number (what the board reads).
//
// A schedule-registered function 403s on external HTTP, so the recovery logic lives in the
// HTTP-callable backfill-part-numbers core; this thin wrapper just fires it a few times
// (each run writes ~8 before the function budget, so we loop to clear a day's worth).
// The PROPER fix is the write path (stamp verified_part_number every time) — this keeps
// techs' part numbers visible until that lands.
'use strict';
const { getSecret } = require('./_lib/secrets');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

exports.handler = async function () {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let wrote = 0, rounds = 0, err = null;
  try {
    // Up to 3 passes/run (each writes ~8); stops early once nothing is left to recover.
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${BASE}/backfill-part-numbers?secret=${encodeURIComponent(admin)}&confirm=1&limit=8`, { signal: AbortSignal.timeout(24000) });
      const d = await r.json().catch(() => ({}));
      rounds++;
      wrote += Number(d.wrote || 0);
      if (!Number(d.wrote || 0)) break;
    }
  } catch (e) { err = String((e && e.message) || e); }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: !err, recovered: wrote, rounds, err }) };
};
