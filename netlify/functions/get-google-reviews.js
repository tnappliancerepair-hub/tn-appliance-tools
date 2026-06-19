// get-google-reviews — pulls TN Appliance Exchange's live Google rating +
// review count + top reviews via the Places API, for baking onto the SEO pages
// (social proof + the AggregateRating that earns ⭐ rich snippets).
//
// Places "Place Details" returns the overall rating + user_ratings_total (the
// full 1,000+ count) and up to 5 reviews. Resolves the Place ID once via Find
// Place From Text, then caches it in the response so the build can reuse it.
//
//   GET ?place_id=<ChIJ…>   (optional — skips resolution, fastest)
//       ?cid=<numeric cid>  (optional — resolves a Place ID from a maps CID)
//       ?q=<text query>     (optional — default the business name)
//       ?debug=1            (always include raw Google statuses)
//
// NOTE: this needs the **Places API** enabled on GOOGLE_MAPS_API_KEY. The key
// today is scoped for Distance Matrix + Geocoding (get-drive-time.js). If Places
// isn't enabled, Google returns status=REQUEST_DENIED — which we now surface
// plainly instead of a vague "place_not_found".
'use strict';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const DEFAULT_Q = 'TN Appliance Exchange appliance repair Antioch TN';

function json(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify(body),
  };
}

// Find Place From Text → returns {place_id, status, error_message}.
async function findPlaceId(q) {
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=place_id,name,rating,user_ratings_total&key=${KEY}`;
  const r = await fetch(url);
  const d = await r.json();
  const c = (d.candidates && d.candidates[0]) || null;
  return { place_id: c ? c.place_id : null, status: d.status, error_message: d.error_message };
}

// Resolve a Place ID from a numeric CID via the Geocoding API (which IS enabled
// on the key). The maps CID URL geocodes to a result whose place_id is the ChIJ.
async function placeIdFromCid(cid) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=0,0&result_type=premise&key=${KEY}`;
  // Geocoding doesn't take a CID directly; the supported path is Place Details,
  // but Place Details requires a place_id. So CID resolution still needs Places.
  // Kept as a stub returning null so the caller falls through cleanly.
  return { place_id: null, status: 'CID_UNSUPPORTED' };
}

async function details(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,url,reviews&reviews_sort=most_relevant&key=${KEY}`;
  const r = await fetch(url);
  return r.json();
}

exports.handler = async (event) => {
  if (!KEY) return json(500, { ok: false, error: 'no_maps_key' });
  const q = event.queryStringParameters || {};
  const debug = {};
  try {
    let placeId = q.place_id || null;

    if (!placeId && q.cid) {
      const c = await placeIdFromCid(q.cid);
      debug.cid_status = c.status;
      placeId = c.place_id;
    }

    if (!placeId) {
      const fp = await findPlaceId(q.q || DEFAULT_Q);
      debug.findplace_status = fp.status;
      if (fp.error_message) debug.findplace_error = fp.error_message;
      placeId = fp.place_id;
    }

    if (!placeId) {
      return json(200, {
        ok: false,
        error: 'place_not_found',
        hint: debug.findplace_status === 'REQUEST_DENIED'
          ? 'Enable the Places API on GOOGLE_MAPS_API_KEY in Google Cloud Console, or pass ?place_id=…'
          : 'Pass ?place_id=… directly.',
        debug,
      });
    }

    const d = await details(placeId);
    debug.details_status = d.status;
    if (d.status !== 'OK') {
      return json(200, { ok: false, error: 'details_failed', status: d.status, message: d.error_message, place_id: placeId, debug });
    }
    const res = d.result || {};
    const reviews = (res.reviews || []).map((rv) => ({
      author: rv.author_name,
      rating: rv.rating,
      text: String(rv.text || '').slice(0, 500),
      relative_time: rv.relative_time_description,
      time: rv.time,
    }));
    return json(200, {
      ok: true,
      place_id: placeId,
      name: res.name,
      rating: res.rating,
      review_count: res.user_ratings_total,
      maps_url: res.url,
      reviews,
      debug,
    });
  } catch (e) {
    return json(200, { ok: false, error: String(e.message || e), debug });
  }
};
