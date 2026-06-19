// get-google-reviews — pulls TN Appliance Exchange's live Google rating +
// review count + top reviews via the Places API, for baking onto the SEO pages
// (social proof + the AggregateRating that earns ⭐ rich snippets).
//
// Places "Place Details" returns the overall rating + user_ratings_total (the
// full 1,000+ count) and up to 5 reviews. Resolves the Place ID once via Find
// Place From Text, then caches it in the response so the build can reuse it.
//
//   GET ?place_id=<id>   (optional — else resolved from the business name)
//       ?q=<text query>  (optional — default "TN Appliance Exchange")
'use strict';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const DEFAULT_Q = 'TN Appliance Exchange appliance repair Antioch TN';

function json(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, body: JSON.stringify(body) };
}

async function findPlaceId(q) {
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=place_id,name,rating,user_ratings_total&key=${KEY}`;
  const r = await fetch(url);
  const d = await r.json();
  const c = (d.candidates && d.candidates[0]) || null;
  return c ? c.place_id : null;
}

async function details(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,url,reviews&reviews_sort=most_relevant&key=${KEY}`;
  const r = await fetch(url);
  return r.json();
}

exports.handler = async (event) => {
  if (!KEY) return json(500, { ok: false, error: 'no_maps_key' });
  const q = (event.queryStringParameters || {});
  try {
    let placeId = q.place_id || (await findPlaceId(q.q || DEFAULT_Q));
    if (!placeId) return json(200, { ok: false, error: 'place_not_found' });
    const d = await details(placeId);
    if (d.status !== 'OK') return json(200, { ok: false, error: 'details_failed', status: d.status, message: d.error_message });
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
    });
  } catch (e) {
    return json(200, { ok: false, error: String(e.message || e) });
  }
};
