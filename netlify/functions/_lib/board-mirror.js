// _lib/board-mirror — the sync logic that keeps Supabase `board_mirror` fresh from
// Xano's get_office_kanban. Lives in a lib so BOTH the HTTP-callable core
// (board-mirror-sync, for manual test/kick) and the scheduled wrapper
// (board-mirror-sync-cron) share it — the proven pattern that dodges the Netlify
// "scheduled functions edge-403 on manual HTTP" footgun.
'use strict';

const sb = require('./supabase');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

const NUM = new Set(['id', 'customer_id', 'technician_id', 'created_at', 'job_completed_at', 'scheduled_start']);
const BOOL = new Set(['parallel_mode']);
const COLS = [
  'id', 'appliance', 'brand', 'claim_number', 'created_at', 'current_status',
  'customer_first', 'customer_id', 'customer_last', 'customer_phone',
  'customer_preference_text', 'dispatch_source_id', 'intake_source',
  'job_completed_at', 'office_stage', 'parallel_mode', 'parts_eta_date',
  'parts_status', 'problem_summary', 'scheduled_start', 'scheduling_status',
  'service_city', 'service_eta_window', 'service_state', 'service_zip',
  'technician_id', 'warranty_company',
];

function shape(j) {
  const row = {};
  for (const c of COLS) {
    let v = j[c];
    if (NUM.has(c)) {
      const n = Number(v);
      v = Number.isFinite(n) ? n : (c === 'id' ? undefined : 0);
    } else if (BOOL.has(c)) {
      v = !!v;
    } else {
      v = v == null ? '' : String(v);
      if (c === 'problem_summary' && v.length > 120) v = v.slice(0, 120) + '…';
      if (c === 'customer_preference_text' && v.length > 160) v = v.slice(0, 160) + '…';
    }
    row[c] = v;
  }
  return row;
}

async function fetchKanban() {
  const r = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(24000) });
  if (!r.ok) throw new Error('xano_' + r.status);
  const d = await r.json();
  return Array.isArray(d.items) ? d.items : [];
}

// Pull the heavy Xano query once, upsert every job into board_mirror, prune the
// jobs that fell off the feed. Returns { ok, synced, pruned, ms }.
async function syncBoardMirror() {
  const t0 = Date.now();
  const items = await fetchKanban();
  if (!items.length) return { ok: false, error: 'empty_feed', ms: Date.now() - t0 };

  // Stamp every row with this run's timestamp so max(synced_at) is a TRUE heartbeat
  // (was default-now() on insert only, which read as "stale" even while the sync ran
  // fine — jobs just hadn't changed). Now "is the mirror current / still receiving
  // Xano?" is a reliable one-query check during the crossover.
  const syncedAt = new Date().toISOString();
  const rows = items.map(shape).filter((x) => x.id != null).map((r) => ({ ...r, synced_at: syncedAt }));
  const ids = rows.map((x) => x.id);

  await sb.upsert('board_mirror', rows, { onConflict: 'id' });

  let pruned = 0;
  try {
    const existing = await sb.select('board_mirror', { select: 'id', limit: '2000' });
    const live = new Set(ids);
    const stale = existing.map((x) => x.id).filter((id) => !live.has(id));
    for (let i = 0; i < stale.length; i += 200) {
      const chunk = stale.slice(i, i + 200);
      await sb.del('board_mirror', { id: `in.(${chunk.join(',')})` });
      pruned += chunk.length;
    }
  } catch (_) { /* prune best-effort */ }

  return { ok: true, synced: rows.length, pruned, ms: Date.now() - t0 };
}

module.exports = { syncBoardMirror, fetchKanban, shape, COLS };
