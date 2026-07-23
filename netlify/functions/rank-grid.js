// rank-grid — our own "Local Falcon": a geo-grid Google map-pack rank tracker.
// Drops a grid of points across a metro, runs a Places Text Search (New) biased to
// each point, and finds where TN Appliance Exchange's listing lands at that spot.
// Green where we're top-3, red where we're buried. This is the exact method every
// paid rank tracker uses — an APPROXIMATION of the live map pack (Google personalizes
// the real thing), but directionally accurate and perfect for tracking change over time.
//
//   GET ?secret=<admin>&metro=tn|tn-clarksville|la [&q=appliance repair] [&size=6] [&scan=1]
//       ?lat=&lng=&span=  (custom center + miles across, overrides preset)
//   -> { ok, metro, q, center, span_mi, size, scanned_at, points:[{lat,lng,rank,name}], summary }
//
// Without scan=1 it returns the most recent CACHED scan for that metro+q (free/instant).
// With scan=1 it runs a fresh grid (a few $ of Places calls) and caches it.
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const BASE = 'https://places.googleapis.com/v1';
const OUR_PLACE_ID = 'ChIJaf5YgBQNZIgRG36-j754Anc';   // Tn Appliance Exchange LLC
const OUR_NAME_RE = /tn\s*appliance|appliance\s*exchange/i;
const EVENT_LOG = (crud.TABLES && crud.TABLES.event_log) || 3;

const PRESETS = {
  'tn':            { lat: 36.05, lng: -86.66, span: 40, size: 6, label: 'Middle TN (Nashville metro)' },
  'tn-clarksville':{ lat: 36.53, lng: -87.35, span: 16, size: 4, label: 'Clarksville' },
  'la':            { lat: 30.22, lng: -90.32, span: 66, size: 6, label: 'South Louisiana (North + South Shore)' },
};

function json(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}

// Build an N×N grid of {lat,lng} centered on (clat,clng) spanning `span` miles edge-to-edge.
function makeGrid(clat, clng, span, size) {
  const pts = [];
  const half = span / 2;
  const step = size > 1 ? span / (size - 1) : 0;
  const miPerLat = 69.0;
  const miPerLng = 69.0 * Math.cos((clat * Math.PI) / 180) || 69.0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const dLatMi = -half + r * step;   // north negative->south; sign doesn't matter for a symmetric grid
      const dLngMi = -half + c * step;
      pts.push({
        lat: +(clat + dLatMi / miPerLat).toFixed(6),
        lng: +(clng + dLngMi / miPerLng).toFixed(6),
        _step_mi: step,
      });
    }
  }
  return pts;
}

// Places Text Search (New), biased to a point. Returns the ordered list (up to ~20).
async function searchAt(key, q, lat, lng, radiusM) {
  try {
    const r = await fetch(`${BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName',
      },
      body: JSON.stringify({
        textQuery: q,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, err: (d && d.error && (d.error.status || d.error.message)) || 'error', places: [] };
    return { ok: true, places: (d && d.places) || [] };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e).slice(0, 80), places: [] };
  }
}

function rankOf(places) {
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    const nm = (p.displayName && p.displayName.text) || '';
    if (p.id === OUR_PLACE_ID || OUR_NAME_RE.test(nm)) return { rank: i + 1, name: nm };
  }
  return { rank: null, name: null };
}

// Run tasks with limited concurrency.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

function summarize(points) {
  const total = points.length;
  const found = points.filter((p) => p.rank != null);
  const top3 = points.filter((p) => p.rank != null && p.rank <= 3).length;
  const top10 = points.filter((p) => p.rank != null && p.rank <= 10).length;
  const ranks = found.map((p) => p.rank);
  const avg = ranks.length ? +(ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1) : null;
  return {
    total,
    found: found.length,
    not_found: total - found.length,
    top3, top10,
    pct_top3: Math.round((top3 / total) * 100),
    pct_top10: Math.round((top10 / total) * 100),
    pct_found: Math.round((found.length / total) * 100),
    avg_rank_found: avg,
    best: ranks.length ? Math.min(...ranks) : null,
    worst: ranks.length ? Math.max(...ranks) : null,
  };
}

async function latestCached(metro, q) {
  try {
    const rows = await crud.searchPage(EVENT_LOG, { action: 'rank_grid_scan' }, { id: 'desc' }, 200);
    for (const row of (rows && rows.items) || rows || []) {
      const m = row.metadata || {};
      if (m.metro === metro && (m.q || '') === q) return m;
    }
  } catch (_) {}
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const keyword = String(q.q || 'appliance repair').slice(0, 80);
  const metro = String(q.metro || 'tn');
  const preset = PRESETS[metro] || PRESETS.tn;

  const clat = q.lat != null ? parseFloat(q.lat) : preset.lat;
  const clng = q.lng != null ? parseFloat(q.lng) : preset.lng;
  const span = q.span != null ? Math.max(4, Math.min(120, parseFloat(q.span))) : preset.span;
  const size = q.size != null ? Math.max(2, Math.min(8, parseInt(q.size, 10))) : preset.size;

  if (q.probe) {
    let hasKey = false;
    try { hasKey = !!(await getSecret('GOOGLE_PLACES_API_KEY')); } catch (_) {}
    return json(200, { ok: true, probe: true, key_configured: hasKey, our_place_id: OUR_PLACE_ID, presets: Object.keys(PRESETS), metro, center: { lat: clat, lng: clng }, span_mi: span, size, points: size * size });
  }

  // Cached read (default) — instant, free.
  if (!q.scan) {
    const cached = await latestCached(metro, keyword);
    if (cached) return json(200, { ok: true, cached: true, ...cached });
    return json(200, { ok: true, cached: true, empty: true, note: 'no scan yet for this metro+keyword — call again with &scan=1', metro, q: keyword });
  }

  // Fresh scan.
  let key = '';
  try { key = (await getSecret('GOOGLE_PLACES_API_KEY')) || ''; } catch (_) {}
  if (!key) key = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!key) return json(500, { ok: false, error: 'no_places_key', hint: 'Store GOOGLE_PLACES_API_KEY in the vault (admin-secrets.html), Places API (New) enabled.' });

  // DEBUG: one search at center, return the ordered list so we can see what Places returns.
  if (q.debug) {
    const s = await searchAt(key, keyword, clat, clng, 8000);
    return json(200, { ok: s.ok, err: s.err, count: (s.places || []).length,
      our_match: rankOf(s.places || []),
      places: (s.places || []).map((p, i) => ({ n: i + 1, id: p.id, name: (p.displayName && p.displayName.text) || '' })) });
  }

  const grid = makeGrid(clat, clng, span, size);
  const stepMi = grid[0]._step_mi || span;
  const radiusM = Math.round(Math.max(2500, Math.min(14000, (stepMi * 1609) / 2)));

  const results = await pool(grid, 8, async (pt) => {
    const s = await searchAt(key, keyword, pt.lat, pt.lng, radiusM);
    if (!s.ok) return { lat: pt.lat, lng: pt.lng, rank: null, name: null, err: s.err || ('http_' + s.status) };
    const { rank, name } = rankOf(s.places);
    return { lat: pt.lat, lng: pt.lng, rank, name };
  });

  const errCount = results.filter((r) => r.err).length;
  const summary = summarize(results);
  const payload = {
    metro, label: preset.label, q: keyword,
    center: { lat: clat, lng: clng }, span_mi: span, size,
    scanned_at: null, scanned_ms: null,   // stamped below (Date.now allowed in Netlify runtime)
    points: results, summary, errors: errCount,
  };
  payload.scanned_ms = Date.now();
  payload.scanned_at = new Date(payload.scanned_ms).toISOString();

  try { await crud.insert(EVENT_LOG, { action: 'rank_grid_scan', metadata: payload }); } catch (_) {}

  return json(200, { ok: true, cached: false, ...payload });
};
