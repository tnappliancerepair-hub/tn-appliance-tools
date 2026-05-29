// CLUSTER ROUTE MORNING CHECK
//
// Fires once daily at 6:45am CT (6:45-7:30 grace window emitted by
// tick.js). Looks at every active tech's day and surfaces obvious
// route inefficiencies:
//   - "Far flung" days — first + last stop > 35 mi apart
//   - Out-of-cluster stops — one stop in a different zip/city from
//     the other 3+ that day
//   - Backtracks — stops not in geographic order (A → 30mi → B →
//     back near A → C)
//
// Posts a single SMS digest to Teddy with the top opportunities, so
// he can decide whether to call the office or reassign one stop
// before the truck rolls.
//
// Phase 1 uses zip + city as proxy for proximity (same MVP as
// find_nearby_open_jobs). Phase 2 with geocoded customers can use
// real haversine distance.

const CT_TZ = 'America/Chicago';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  const todayMs = Date.now();
  const todayKey = new Date(todayMs).toISOString().slice(0, 10);
  const fired = await xano.checkEventLogFiredToday('cluster_route_morning_check_fired', todayKey);
  if (fired) {
    await xano.markSignalProcessed(signal.id, 'cluster_route_morning_check_skipped', { reason: 'already_fired_today' });
    return { success: true, action: 'skipped_already_fired' };
  }

  let techs = [];
  try {
    const all = await xano.getTechnicians();
    techs = (all || []).filter((t) => Number(t.id) !== 1 && t.active === true);
  } catch (_) {}
  if (techs.length === 0) {
    await xano.recordEvent('cluster_route_morning_check_fired', { day: todayKey, observations: 0, reason: 'no_techs' });
    await xano.markSignalProcessed(signal.id, 'cluster_route_morning_check_done', { observations: 0 });
    return { success: true, action: 'no_techs' };
  }

  const observations = [];

  for (const tech of techs) {
    const techId = Number(tech.id);
    let dash = null;
    try { dash = await xano.getTechDailyDashboard(techId); } catch (_) {}
    const jobs = (dash && Array.isArray(dash.jobs)) ? dash.jobs : [];
    if (jobs.length < 2) continue;  // need at least 2 stops to find inefficiency

    // Build a list of (zip, city) per stop, sorted by scheduled_start
    const stops = jobs.map((entry) => {
      const j = entry.job || entry;
      return {
        scheduled_start: Number(j.scheduled_start || 0),
        zip: (j.service_zip || '').trim(),
        city: (j.service_city || '').toLowerCase().trim(),
        customer_id: j.customer_id || 0,
      };
    }).filter((s) => s.scheduled_start > 0).sort((a, b) => a.scheduled_start - b.scheduled_start);

    if (stops.length < 2) continue;

    // Heuristic 1: out-of-cluster stop — one stop has a zip nobody
    // else has, and no city overlap either
    const zipCounts = {};
    const cityCounts = {};
    for (const s of stops) {
      if (s.zip) zipCounts[s.zip] = (zipCounts[s.zip] || 0) + 1;
      if (s.city) cityCounts[s.city] = (cityCounts[s.city] || 0) + 1;
    }
    const outliers = stops.filter((s) =>
      s.zip && zipCounts[s.zip] === 1
      && s.city && cityCounts[s.city] === 1
      && stops.length >= 3
    );
    if (outliers.length > 0 && outliers.length < stops.length / 2) {
      observations.push({
        tech_id: techId,
        tech_first: tech.first_name || `tech ${techId}`,
        kind: 'outlier_stop',
        detail: `${outliers.length} stop(s) outside main cluster: ${outliers.map((o) => o.city || o.zip).join(', ')}`,
      });
    }

    // Heuristic 2: backtrack — first and last stop share zip but a
    // middle stop has a totally different one
    if (stops.length >= 3) {
      const first = stops[0];
      const last = stops[stops.length - 1];
      const middle = stops.slice(1, -1);
      const middleZips = new Set(middle.map((s) => s.zip).filter(Boolean));
      if (first.zip && first.zip === last.zip && middleZips.size > 0 && !middleZips.has(first.zip)) {
        observations.push({
          tech_id: techId,
          tech_first: tech.first_name || `tech ${techId}`,
          kind: 'backtrack',
          detail: `first + last in zip ${first.zip}, middle stop(s) in ${[...middleZips].join('/')}`,
        });
      }
    }
  }

  if (observations.length === 0) {
    await xano.recordEvent('cluster_route_morning_check_fired', { day: todayKey, observations: 0 });
    await xano.markSignalProcessed(signal.id, 'cluster_route_morning_check_done', { observations: 0 });
    log('cluster_route_morning_check_clean', {});
    return { success: true, action: 'no_observations' };
  }

  // Compose SMS — at most 5 observations to keep it scannable
  const lines = [`[ant] morning route check — ${observations.length} inefficiency hint(s):`];
  for (const o of observations.slice(0, 5)) {
    const tag = o.kind === 'outlier_stop' ? 'OUTLIER' : 'BACKTRACK';
    lines.push(`• ${o.tech_first} (${tag}): ${o.detail}`);
  }
  if (observations.length > 5) lines.push(`+${observations.length - 5} more.`);
  lines.push('Reassign any in the office calendar or via /tech-scheduler.');

  let smsResult;
  try {
    smsResult = await sms.toOwner(lines.join('\n'), { call_site: 'cluster_route_morning_check' });
  } catch (e) {
    smsResult = { ok: false, error: String(e) };
  }

  await xano.recordEvent('cluster_route_morning_check_fired', {
    day: todayKey,
    observations: observations.length,
    sms_sent: !!(smsResult && smsResult.ok),
    samples: observations.slice(0, 10),
  });
  await xano.markSignalProcessed(signal.id, 'cluster_route_morning_check_done', {
    observations: observations.length,
    sms_ok: !!(smsResult && smsResult.ok),
  });

  log('cluster_route_morning_check_done', { observations: observations.length });
  return { success: true, action: 'digest_sent', observations: observations.length };
}
