// board-feed-fast — serves the office board from the Supabase `board_mirror`
// table (~50-100ms) instead of Xano's slow 4-16s get_office_kanban query.
//
// board-mirror-sync keeps the mirror fresh (once per cycle, server-side). This
// endpoint just reads it, so every office user shares fast Supabase reads and the
// board is fully decoupled from Xano compute. Returns the SAME { items: [...] }
// shape the board already consumes — a drop-in for board-feed.
//
// SAFE BY DESIGN: if the mirror is empty (not yet created/populated) or Supabase
// errors, it transparently falls back to the existing board-feed proxy, so this is
// never worse than today — it only gets FAST once the mirror is live.
'use strict';

const sb = require('./_lib/supabase');

const COLS = [
  'id', 'appliance', 'brand', 'claim_number', 'created_at', 'current_status',
  'customer_first', 'customer_id', 'customer_last', 'customer_phone',
  'customer_preference_text', 'dispatch_source_id', 'intake_source',
  'job_completed_at', 'office_stage', 'parallel_mode', 'parts_eta_date',
  'parts_status', 'problem_summary', 'scheduled_start', 'scheduling_status',
  'service_city', 'service_eta_window', 'service_state', 'service_zip',
  'technician_id', 'warranty_company',
].join(',');

const SITE = 'https://tnapplianceexchange.net';

async function fromMirror() {
  const rows = await sb.select('board_mirror', { select: COLS, limit: '2000' });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows;
}

async function fromFeed() {
  const r = await fetch(`${SITE}/.netlify/functions/board-feed`, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  return (d && Array.isArray(d.items)) ? d.items : null;
}

// Last-good mirror snapshot held in the warm container. Once the mirror has answered
// even once, a later slow/cold read serves this instantly instead of falling through to
// the slow Xano feed — which is what caused the intermittent 20s board hangs.
let _lastGood = null;

exports.handler = async function () {
  let items = null, src = 'mirror';
  // Cap the mirror read tight (6s) so a cold/slow Supabase read can't hang the board.
  try {
    const raced = await Promise.race([
      fromMirror(),
      new Promise((res) => setTimeout(() => res('__slow__'), 6000)),
    ]);
    items = raced === '__slow__' ? null : raced;
  } catch (_) { items = null; }

  if (Array.isArray(items) && items.length) {
    _lastGood = items;                                  // remember the good result
  } else if (_lastGood) {
    items = _lastGood; src = 'mirror_cached';           // slow this instant → serve last-good, never hang on Xano
  } else {
    src = 'feed_fallback';                              // nothing cached yet → bounded Xano last resort
    try {
      items = await Promise.race([
        fromFeed(),
        new Promise((res) => setTimeout(() => res(null), 8000)),
      ]);
    } catch (_) { items = null; }
  }

  if (!items) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: 'no_source' }) };
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-Board-Source': src,
      // Short shared edge cache — the mirror updates every ~minute anyway, so a
      // 15s shared cache collapses bursty concurrent loads to one Supabase read
      // without adding meaningful staleness on top of the sync cycle.
      'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=15, stale-while-revalidate=120',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
    body: JSON.stringify({ items, source: src }),
  };
};
