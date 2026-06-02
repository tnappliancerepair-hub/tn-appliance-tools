// Signal in: CUSTOMER_AVAILABILITY_CHANGED
// v2 (action mode) — graduated from observer 2026-06-02.
//
// Customer just expanded availability on their portal. Pull the bundle
// of {job, grid, all active techs, tech_availability blocks for 21d},
// run the matcher to find the soonest tech × block intersection, and
// call auto_schedule_book to actually reserve the slot.
//
// On success: APPOINTMENT_SCHEDULED signal fires (existing chain handles
// customer + tech confirmation SMS).
// On no-match: SMS Teddy with the gap so he can decide.

import { config } from '../config.js';

const BLOCK_START_HOUR = { morning: 8, afternoon: 12, evening: 17 };
const BLOCK_END_HOUR   = { morning: 12, afternoon: 17, evening: 20 };
const BLOCK_ORDER      = ['morning', 'afternoon', 'evening'];

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

function parseHourString(s) {
  // "09:00" → 9, "07:30" → 7
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2})/);
  return m ? Math.min(23, Math.max(0, parseInt(m[1], 10))) : null;
}

function dayOfWeek(yyyymmdd) {
  // Pure-string parsing avoids timezone weirdness. Returns 0=Sun, 6=Sat.
  const d = new Date(yyyymmdd + 'T12:00:00Z');
  return d.getUTCDay();
}

function isOnFullDayOff(techId, dateStr, availBlocks) {
  return availBlocks.some(
    (a) => a && a.technician_id === techId && a.blocked_date === dateStr && a.full_day_off === true,
  );
}

function computeStartMs(dateStr, hour) {
  // Date string + hour in CT → UTC ms. CT is UTC-5 (standard) / UTC-4 (DST).
  // Use -5 universally for v1 — drift of 1hr in summer is acceptable for
  // first-pass scheduling; tech can adjust if needed.
  const iso = `${dateStr}T${String(hour).padStart(2, '0')}:00:00-05:00`;
  return new Date(iso).getTime();
}

function findBestMatch(grid, techs, availBlocks, nowMs) {
  // Iterate days chronologically, blocks morning→afternoon→evening,
  // techs in id order. First match wins.
  const sortedGrid = [...grid].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (const entry of sortedGrid) {
    if (!entry || !entry.date || !Array.isArray(entry.blocks)) continue;
    const dateStr = entry.date;
    const blocks = entry.blocks.slice().sort((a, b) => BLOCK_ORDER.indexOf(a) - BLOCK_ORDER.indexOf(b));
    const dow = dayOfWeek(dateStr);

    for (const block of blocks) {
      if (!BLOCK_START_HOUR.hasOwnProperty(block)) continue;
      const blockStart = BLOCK_START_HOUR[block];
      const blockEnd = BLOCK_END_HOUR[block];

      for (const tech of techs) {
        if (!tech || tech.active !== true) continue;

        // Saturday opt-in: only book Sat if tech.works_saturdays = true.
        // Sunday is fully closed company-wide.
        if (dow === 0) continue;
        if (dow === 6 && tech.works_saturdays !== true) continue;

        const techStart = parseHourString(tech.preferred_hours_start);
        const techEnd = parseHourString(tech.preferred_hours_end);
        if (techStart == null || techEnd == null) continue;
        if (techStart > blockStart || techEnd < blockEnd) continue;

        if (isOnFullDayOff(tech.id, dateStr, availBlocks)) continue;

        const startHour = Math.max(blockStart, techStart);
        const startMs = computeStartMs(dateStr, startHour);
        if (startMs < nowMs) continue;

        return {
          tech_id: tech.id,
          tech_first_name: tech.first_name || '',
          scheduled_start_ms: startMs,
          date: dateStr,
          block,
          start_hour: startHour,
        };
      }
    }
  }
  return null;
}

export async function run(signal, ctx) {
  const { sms, xano, log } = ctx;
  const p = signal.payload || {};
  const jobId = p.job_id;

  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'no_job_id' });
    return { success: false, action: 'no_job_id' };
  }

  // Dedup — only one auto-schedule attempt per job per 30 min so
  // repeated availability taps don't flood retries.
  const dedupKey = `auto_schedule_attempted_${jobId}`;
  let recent = null;
  try {
    recent = await xano.findRecentEventLog
      ? await xano.findRecentEventLog(dedupKey, Date.now() - 30 * 60 * 1000)
      : null;
  } catch (_) { recent = null; }
  if (recent && recent.found) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'recent_attempt_skipped' });
    return { success: true, action: 'recent_attempt_skipped' };
  }

  let bundle;
  try {
    const r = await fetch(`${XANO_BASE}/get_auto_schedule_data?job_id=${jobId}`);
    bundle = await r.json();
  } catch (e) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'bundle_fetch_failed', error: String(e.message || e) });
    return { success: false, action: 'bundle_fetch_failed' };
  }

  if (!bundle || !bundle.success) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'bundle_error', error: bundle?.error || 'unknown' });
    return { success: false, action: 'bundle_error' };
  }

  let grid = [];
  try {
    grid = bundle.customer_availability_grid ? JSON.parse(bundle.customer_availability_grid) : [];
  } catch (_) { grid = []; }

  if (!Array.isArray(grid) || grid.length === 0) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'no_grid_yet' });
    return { success: true, action: 'no_grid_yet' };
  }

  const match = findBestMatch(grid, bundle.techs || [], bundle.availability_blocks || [], Date.now());

  if (!match) {
    // No tech × block match found. SMS Teddy so he can decide.
    if (config.ownerPhone) {
      const body = `[ant] auto-schedule found NO match for job #${jobId}. Customer marked ${grid.length} day${grid.length === 1 ? '' : 's'} but no active tech fits. Tap to review: ${(config.publicSiteBase || 'tnapplianceexchange.net').replace(/^https?:\/\//, '')}/job-detail.html?job_id=${jobId}`;
      try { await sms.toOwner(body, { action: 'auto_schedule_no_match', job_id: jobId }); } catch (_) {}
    }
    const meta = { outcome: 'no_match_found', job_id: jobId, days_in_grid: grid.length };
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', meta);
    try { await xano.recordEventLog(dedupKey, meta); } catch (_) {}
    log('auto_schedule_no_match', meta);
    return { success: true, action: 'no_match_found' };
  }

  // Book it
  let bookRes;
  try {
    const r = await fetch(`${XANO_BASE}/auto_schedule_book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        technician_id: match.tech_id,
        scheduled_start_ms: match.scheduled_start_ms,
        matched_block: `${match.date} ${match.block}`,
      }),
    });
    bookRes = await r.json();
  } catch (e) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'book_fetch_failed', error: String(e.message || e) });
    return { success: false, action: 'book_fetch_failed' };
  }

  if (!bookRes || !bookRes.success) {
    await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', { outcome: 'book_failed', error: bookRes?.error || 'unknown' });
    return { success: false, action: 'book_failed' };
  }

  const meta = {
    outcome: 'auto_scheduled',
    job_id: jobId,
    tech_id: match.tech_id,
    tech_name: match.tech_first_name,
    date: match.date,
    block: match.block,
    scheduled_start_ms: match.scheduled_start_ms,
  };
  await xano.markSignalProcessed(signal.id, 'customer_availability_changed_handled', meta);
  try { await xano.recordEventLog(dedupKey, meta); } catch (_) {}
  log('auto_scheduled', meta);
  return { success: true, action: 'auto_scheduled', match };
}
