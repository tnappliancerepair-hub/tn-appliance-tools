// get-google-reviews — pulls TN Appliance Exchange's live Google rating +
// review count + top reviews via the **Places API (New)**, for baking onto the
// SEO pages (social proof + the AggregateRating that earns ⭐ rich snippets).
//
// Uses the new endpoints (places.googleapis.com/v1) because the legacy Places
// API is being retired and was REQUEST_DENIED on our key:
//   - Text Search:   POST  /v1/places:searchText        (resolve the place)
//   - Place Details: GET   /v1/places/{PLACE_ID}         (rating + reviews)
//
//   GET ?place_id=<ChIJ…>   (optional — skips resolution, fastest)
//       ?q=<text query>     (optional — default the business name)
//
// REQUIRES: "Places API (New)" enabled on GOOGLE_MAPS_API_KEY in Google Cloud
// Console. If it isn't, Google returns 403 PERMISSION_DENIED — surfaced plainly
// in `debug` so we know to enable it (vs. a vague "place_not_found").
'use strict';

// Prefer a dedicated Places key (so enabling Places API (New) can't affect the
// Distance Matrix/Geocoding key used by get-drive-time.js). Falls back to the
// shared maps key if Places is enabled there instead.
const KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const DEFAULT_Q = 'TN Appliance Exchange appliance repair Antioch TN';
const BASE = 'https://places.googleapis.com/v1';

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify(body),
  };
}

// Text Search (New) → first matching place id.
async function searchText(q) {
  const r = await fetch(`${BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({ textQuery: q }),
  });
  const d = await r.json();
  const place = (d.places && d.places[0]) || null;
  return { id: place ? place.id : null, http: r.status, error: d.error ? (d.error.status || d.error.message) : null };
}

// Place Details (New) → rating, count, reviews, maps uri.
async function details(placeId) {
  const r = await fetch(`${BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,googleMapsUri,reviews',
    },
  });
  const d = await r.json();
  return { d, http: r.status };
}

exports.handler = async (event) => {
  if (!KEY) return json(500, { ok: false, error: 'no_maps_key' });
  const q = event.queryStringParameters || {};
  const debug = {};
  try {
    let placeId = q.place_id || null;

    if (!placeId) {
      const s = await searchText(q.q || DEFAULT_Q);
      debug.search_http = s.http;
      if (s.error) debug.search_error = s.error;
      placeId = s.id;
    }

    if (!placeId) {
      return json(200, {
        ok: false,
        error: 'place_not_found',
        hint: debug.search_http === 403
          ? 'Enable "Places API (New)" on GOOGLE_MAPS_API_KEY in Google Cloud Console, then retry.'
          : 'Pass ?place_id=… directly, or check the query.',
        debug,
      });
    }

    const { d, http } = await details(placeId);
    debug.details_http = http;
    if (d.error || !d.rating) {
      return json(200, { ok: false, error: 'details_failed', place_id: placeId, google_error: d.error || null, debug });
    }

    const reviews = (d.reviews || []).map((rv) => ({
      author: rv.authorAttribution && rv.authorAttribution.displayName,
      rating: rv.rating,
      text: String((rv.text && rv.text.text) || (rv.originalText && rv.originalText.text) || '').slice(0, 600),
      relative_time: rv.relativePublishTimeDescription,
      time: rv.publishTime,
    }));

    return json(200, {
      ok: true,
      place_id: placeId,
      name: d.displayName && d.displayName.text,
      rating: d.rating,
      review_count: d.userRatingCount,
      maps_url: d.googleMapsUri,
      reviews,
      debug,
    });
  } catch (e) {
    return json(200, { ok: false, error: String(e.message || e), debug });
  }
};
