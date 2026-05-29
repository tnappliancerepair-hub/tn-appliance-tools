// SCHEDULER FILL THE GAP
//
// Fires on JOB_COMPLETED. When a tech finishes 30+ min ahead of
// schedule AND there are open / parts-ready jobs nearby, drops them
// a SMARTER SMS than the generic post-stop checkin:
//
//   "[ant] nice — wrapped 42 min early in Antioch. Mrs Jones is
//    1.8 mi away (LG range, AHS, ready now — no parts needed).
//    Want me to add her to your day? Tap: <link>"
//
// This is the dream scenario Teddy described:
//   "It could even notice that he's in an area where there's
//    customers that are have an open schedule. Hey, you're in
//    this area. Missus Jones is open, and she's less than two
//    miles away. Would you like me to add her to your schedule?"
//
// Defers to the general scheduler_post_stop_checkin if no candidates
// exist or the tech isn't actually ahead. They don't conflict —
// both fire on JOB_COMPLETED, this one is gated more tightly so
// only one SMS reaches the tech per stop.
//
// Gate set:
//   - Skip owner (tech_id 1)
//   - Skip if tech finished < 30 min early
//   - Skip if no parts-ready candidates within the just-completed job's zip or city
//   - Skip if tech already got a "fill the gap" SMS in the last 60 min (dedup)
//   - Skip after 7pm CT / before 6am CT
//
// Lets the regular post_stop_checkin take over when this skips, so
// no signal is silently dropped.

const CT_TZ = 'America/Chicago';
const BASE_URL = 'https://tnapplianceexchange.net';
const MIN_AHEAD_MIN = 30;
const DEDUP_WINDOW_MIN = 60;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id);
  const techIdFromPayload = Number(payload.technician_id || 0);

  if (!techIdFromPayload || techIdFromPayload === 1) {
    await xano.markSignalProcessed(signal.id, 'fill_gap_skipped', { reason: 'no_tech_or_owner' });
    return { success: true, action: 'skipped_owner_or_no_tech' };
  }

  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: CT_TZ, hour: 'numeric', hour12: false }), 10);
  if (hour < 6 || hour >= 19) {
    await xano.markSignalProcessed(signal.id, 'fill_gap_skipped', { reason: 'after_hours' });
    return { success: true, action: 'skipped_after_hours' };
  }

  // Dedup — 60-min window per tech
  const dedupAction = `fill_gap_sent_${techIdFromPayload}`;
  try {
    const recent = await xano.listRecentEventLog({ action: dedupAction, days_back: 1, limit: 1 });
    if (recent && recent.length > 0) {
      const last = Number(recent[0].created_at || 0);
      if (last && Date.now() - last < DEDUP_WINDOW_MIN * 60000) {
        await xano.markSignalProcessed(signal.id, 'fill_gap_skipped', { reason: 'sent_recently' });
        return { success: true, action: 'skipped_recent' };
      }
    }
  } catch (_) {}

  // Resolve completed job + tech
  let tech = null;
  try {
    const all = await xano.getTechnicians();
    tech = (all || []).find((t) => Number(t.id) === techIdFromPayload) || null;
  } catch (_) {}
  if (!tech || !tech.phone) {
    await xano.markSignalProcessed(signal.id, 'fill_gap_skipped', { reason: 'no_tech_phone' });
    return { success: true, action: 'skipped_no_phone' };
  }

  // Pull completed job context — need its zip/city + scheduled_end
  let completedJob = null;
  let aheadMin = 0;
  try {
    const dash = await xano.getTechDailyDashboard(techIdFromPayload);
    const myDay = (dash && Array.isArray(dash.jobs)) ? dash.jobs : [];
    const completedEntry = myDay.find((e) => (e.job || e).id === jobId);
    if (completedEntry) {
      completedJob = completedEntry.job || completedEntry;
      const schedEnd = Number(completedJob.scheduled_end || 0);
      if (schedEnd > 0) aheadMin = Math.round((schedEnd - Date.now()) / 60000);
    }
  } catch (_) {}

  if (!completedJob || aheadMin < MIN_AHEAD_MIN) {
    await xano.markSignalProcessed(signal.id, 'fill_gap_skipped', { reason: 'not_ahead_enough', ahead_min: aheadMin });
    return { success: true, action: 'skipped_not_ahead' };
  }

  const zip = (completedJob.service_zip || '').trim();
  const city = (completedJob.service_city || '').trim();
  if (!zip && !city) {
    await xano.markSignalProcessed(signal.id, 'fill_gap_skipped', { reason: 'no_location_on_completed_job' });
    return { success: true, action: 'skipped_no_location' };
  }

  // Call find_nearby_open_jobs via xano helper
  let candidates = [];
  try {
    const res = await xano.findNearbyOpenJobs({
      tech_id: techIdFromPayload,
      recent_zip: zip,
      recent_city: city,
      limit: 8,
    }).catch(() => null);
    if (res && Array.isArray(res.items)) {
      candidates = res.items.filter((c) => c.ready_now === true);
    }
  } catch (_) {}

  if (candidates.length === 0) {
    await xano.markSignalProcessed(signal.id, 'fill_gap_skipped', { reason: 'no_nearby_ready_candidates' });
    return { success: true, action: 'skipped_no_candidates' };
  }

  // Pick top candidate to highlight in the SMS
  const top = candidates[0];
  const cityHere = city || zip || 'the area';
  const apl = ((top.brand || '') + ' ' + (top.appliance_type || '')).trim() || 'work';
  const warrantyTag = top.warranty_company ? `, ${top.warranty_company}` : '';
  const otherN = candidates.length - 1;
  const otherStr = otherN > 0 ? ` (+${otherN} more open nearby)` : '';

  const promptText = `I just wrapped early in ${cityHere}. Find me nearby open jobs that are ready to work right now — show me the candidates with proximity + appliance + warranty so I can pick one to add to my day.`;
  const link = `${BASE_URL}/tech-scheduler.html?tech_id=${techIdFromPayload}&prompt=${encodeURIComponent(promptText)}`;

  const firstName = (tech.first_name || 'there').trim();
  const body = `[ant] nice ${firstName} — wrapped ${aheadMin}m early in ${cityHere}. ${top.customer_name} (${apl}${warrantyTag}) is open & ready now${otherStr}. Add to your day? ${link}`;

  let smsResult;
  try {
    smsResult = await sms.toTech({
      tech_id: techIdFromPayload,
      phone: tech.phone,
      body,
      call_site: 'scheduler_fill_gap',
    });
  } catch (e) {
    smsResult = { ok: false, error: String(e) };
  }

  try {
    await xano.recordEvent(dedupAction, {
      job_id: jobId,
      tech_id: techIdFromPayload,
      ahead_min: aheadMin,
      city_hint: cityHere,
      top_candidate_job_id: top.job_id,
      candidate_count: candidates.length,
    });
  } catch (_) {}

  await xano.markSignalProcessed(signal.id, 'fill_gap_handled', {
    job_id: jobId,
    tech_id: techIdFromPayload,
    candidates: candidates.length,
    sms_ok: !!(smsResult && smsResult.ok),
  });

  log('fill_gap_sent', { tech_id: techIdFromPayload, ahead_min: aheadMin, candidates: candidates.length });
  return { success: true, action: 'sent', candidates: candidates.length };
}
