// Drive-time estimator for tech-ant-live's On My Way ETA flow.
// POST {from_address, to_address} -> {success, minutes, meters,
// distance_text, duration_text, source}.
//
// Primary: Google Distance Matrix API (driving mode, best_guess traffic,
// US/CA region biased). Requires GOOGLE_MAPS_API_KEY env var on Netlify.
//
// Fallback when Google is unavailable, returns ZERO_RESULTS, or the key
// is unset: a haversine straight-line estimate at 45mph average. This
// keeps the button usable in rural/no-key states; the SMS just says
// "approximate" via the source flag.

exports.config = { timeout: 10 };

const AVG_MPH = 45;
const METERS_PER_MILE = 1609.344;

function bad(status, msg) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: false, error: msg }),
  };
}

function ok(payload) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, ...payload }),
  };
}

function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function geocode(address, key) {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(address) +
    '&region=us&key=' +
    key;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'OK' || !data.results || data.results.length === 0) return null;
  return data.results[0].geometry.location; // { lat, lng }
}

function haversineFallback(meters) {
  const miles = meters / METERS_PER_MILE;
  const hours = miles / AVG_MPH;
  const minutes = Math.max(5, Math.round(hours * 60));
  return {
    minutes,
    meters: Math.round(meters),
    distance_text: miles.toFixed(1) + ' mi (straight line)',
    duration_text: minutes + ' min (estimate)',
    source: 'haversine_fallback',
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return bad(405, 'POST only');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return bad(400, 'invalid JSON body');
  }

  const from = (body.from_address || '').toString().trim();
  const to = (body.to_address || '').toString().trim();
  if (!from || !to) return bad(400, 'from_address and to_address are required');

  const key = process.env.GOOGLE_MAPS_API_KEY;

  // No key configured: skip Google entirely, attempt a noisy fallback that
  // requires geocoding. Without a key we can't geocode either, so return a
  // soft success with a fixed 25-minute estimate so the UI still works.
  if (!key) {
    return ok({
      minutes: 25,
      meters: null,
      distance_text: 'unknown',
      duration_text: '25 min (default - no maps key)',
      source: 'default_no_key',
    });
  }

  try {
    const url =
      'https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial' +
      '&mode=driving&departure_time=now&traffic_model=best_guess&region=us' +
      '&origins=' +
      encodeURIComponent(from) +
      '&destinations=' +
      encodeURIComponent(to) +
      '&key=' +
      key;

    const res = await fetch(url);
    if (!res.ok) throw new Error('distance_matrix HTTP ' + res.status);
    const data = await res.json();

    const row = data.rows && data.rows[0];
    const el = row && row.elements && row.elements[0];

    if (data.status === 'OK' && el && el.status === 'OK') {
      const durSec = (el.duration_in_traffic && el.duration_in_traffic.value) || el.duration.value;
      const durTxt = (el.duration_in_traffic && el.duration_in_traffic.text) || el.duration.text;
      const distMeters = el.distance.value;
      const distTxt = el.distance.text;
      return ok({
        minutes: Math.max(1, Math.round(durSec / 60)),
        meters: distMeters,
        distance_text: distTxt,
        duration_text: durTxt,
        source: el.duration_in_traffic ? 'google_traffic' : 'google_distance',
      });
    }

    // Distance Matrix failed (ZERO_RESULTS or NOT_FOUND). Try the
    // geocode-then-haversine fallback so the button still works.
    const [fromLoc, toLoc] = await Promise.all([geocode(from, key), geocode(to, key)]);
    if (fromLoc && toLoc) {
      return ok(haversineFallback(haversineMeters(fromLoc, toLoc)));
    }

    return ok({
      minutes: 25,
      meters: null,
      distance_text: 'unknown',
      duration_text: '25 min (default)',
      source: 'default_geocode_failed',
    });
  } catch (err) {
    // Network error or other fault - default-out so the UI never blocks.
    return ok({
      minutes: 25,
      meters: null,
      distance_text: 'unknown',
      duration_text: '25 min (default)',
      source: 'default_exception',
      error_detail: String(err && err.message ? err.message : err).slice(0, 120),
    });
  }
};
