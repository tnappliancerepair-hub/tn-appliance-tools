// Handles SCHEDULE_GAP_CHECK signals (emitted daily from tick.js at 9am CT
// — after the briefing block).
//
// Scans today's calendar across all active techs and surfaces gaps of 2+
// hours where a job could be inserted. Pairs each gap with up to 5
// candidate unscheduled jobs (source_type=ahs_email + scheduling_status=
// not_ready, ordered by created_at desc). SMSes Teddy a single summary.
//
// v1 is detect-and-surface only — no auto-customer-SMS. Teddy decides
// which gap+candidate to act on via the office calendar.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

const GAP_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h
const WORK_DAY_START_HR = 8;
const WORK_DAY_END_HR = 17;
const MAX_CANDIDATES_PER_GAP = 3;
const MAX_GAPS_PER_SMS = 6;

function ctDateStr(ms) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch { return null; }
}

function ctMsForHour(dateStr, hr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', timeZoneName: 'shortOffset',
  }).formatToParts(probe);
  const off = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-5';
  const mm = off.match(/GMT([+-]\d+)/);
  const offHrs = mm ? parseInt(mm[1], 10) : -5;
  return Date.UTC(y, m - 1, d, hr - offHrs, 0, 0);
}

function fmtTimeCT(ms) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(ms)).toLowerCase().replace(/\s/g, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  // Load today's calendar via the existing office endpoint. Pass no
  // week_start so it returns the week containing today.
  let calendar;
  try {
    calendar = await xano.getOfficeCalendarWeek(null);
  } catch (err) {
    log('schedule_gap_check_calendar_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'schedule_gap_check_handled', { outcome: 'calendar_load_failed' });
    return { success: false, action: 'calendar_load_failed' };
  }

  const today = calendar.today_ct;
  const techs = (calendar.technicians || []).filter((t) => t && t.id && t.id !== 1 && t.active === true);
  const todayJobs = (calendar.jobs || []).filter((j) => ctDateStr(j.scheduled_start) === today && j.technician_id);

  // Group today's jobs by tech.
  const byTech = {};
  for (const j of todayJobs) {
    if (!byTech[j.technician_id]) byTech[j.technician_id] = [];
    byTech[j.technician_id].push(j);
  }

  // Identify gaps per tech. Gap = continuous open window inside the work
  // day where no job is scheduled, at least GAP_THRESHOLD_MS wide.
  const dayStartMs = ctMsForHour(today, WORK_DAY_START_HR);
  const dayEndMs = ctMsForHour(today, WORK_DAY_END_HR);
  const gaps = [];
  for (const tech of techs) {
    const sched = (byTech[tech.id] || []).slice().sort((a, b) => (a.scheduled_start || 0) - (b.scheduled_start || 0));
    let cursor = dayStartMs;
    for (const j of sched) {
      const start = Number(j.scheduled_start || 0);
      if (!start) continue;
      // Assume 90min default job width when no scheduled_end_ms.
      const end = Number(j.scheduled_end_ms || (start + 90 * 60 * 1000));
      if (start - cursor >= GAP_THRESHOLD_MS && start <= dayEndMs) {
        gaps.push({
          tech_id: tech.id,
          tech_first: (tech.first_name || '').trim() || `Tech ${tech.id}`,
          gap_start_ms: cursor,
          gap_end_ms: start,
          gap_hours: Math.round((start - cursor) / 3600000 * 10) / 10,
        });
      }
      cursor = Math.max(cursor, end);
    }
    // Tail gap to end of day.
    if (dayEndMs - cursor >= GAP_THRESHOLD_MS) {
      gaps.push({
        tech_id: tech.id,
        tech_first: (tech.first_name || '').trim() || `Tech ${tech.id}`,
        gap_start_ms: cursor,
        gap_end_ms: dayEndMs,
        gap_hours: Math.round((dayEndMs - cursor) / 3600000 * 10) / 10,
      });
    }
    // Whole-day gap for techs with zero jobs today.
    // (sched.length === 0 → cursor stays at dayStartMs, which is captured
    // by the tail-gap block above with full day length.)
  }

  if (gaps.length === 0) {
    const meta = { outcome: 'no_gaps_today', tech_count: techs.length, today };
    await xano.markSignalProcessed(signal.id, 'schedule_gap_check_handled', meta);
    log('schedule_gap_check_handled', meta);
    // Still persist a fired row so dedup works.
    try { await xano.recordEventLog('schedule_gap_check_fired', { outcome: 'no_gaps_today', today }); } catch (_) {}
    return { success: true, action: 'no_gaps_today' };
  }

  // Load candidate unscheduled jobs. Use list_ahs_backlog (AHS not_ready
  // is the largest pool — 16k+ as of 2026-05-26 finding) for v1.
  let candidates = [];
  try {
    const r = await xano.listAhsBacklog(1, 25);
    candidates = (r && r.jobs) || [];
  } catch (err) {
    log('schedule_gap_check_candidates_failed', { error: String(err.message || err) });
  }

  // Compose SMS digest.
  const lines = [`[ant] today's gaps (${today}):`];
  const shown = gaps.slice(0, MAX_GAPS_PER_SMS);
  for (const g of shown) {
    lines.push(`  ${g.tech_first}: ${fmtTimeCT(g.gap_start_ms)}-${fmtTimeCT(g.gap_end_ms)} (${g.gap_hours}h)`);
  }
  if (gaps.length > MAX_GAPS_PER_SMS) lines.push(`  +${gaps.length - MAX_GAPS_PER_SMS} more gaps`);

  if (candidates.length > 0) {
    lines.push(`Unscheduled candidates (${candidates.length}):`);
    for (const c of candidates.slice(0, MAX_CANDIDATES_PER_GAP)) {
      const appl = String(c.appliance_type || 'appliance').toLowerCase();
      const claim = c.claim_number ? ` #${c.claim_number}` : '';
      lines.push(`  job #${c.id} - ${appl}${claim}`);
    }
    if (candidates.length > MAX_CANDIDATES_PER_GAP) {
      lines.push(`  +${candidates.length - MAX_CANDIDATES_PER_GAP} more in AHS backlog`);
    }
  }

  const bareDomain = (config.publicSiteBase || '').replace(/^https?:\/\//, '');
  lines.push(`Calendar: ${bareDomain}/office-calendar.html?view=today`);
  const body = lines.join('\n');

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'schedule_gap_check_digest',
      gap_count: gaps.length,
      candidate_count: candidates.length,
      today,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  // Persist fired row for dedup.
  try {
    await xano.recordEventLog('schedule_gap_check_fired', {
      today,
      gap_count: gaps.length,
      candidate_count: candidates.length,
      gaps,
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('schedule_gap_check_persist_failed', { error: String(err.message || err) });
  }

  const meta = {
    outcome: 'gaps_surfaced',
    gap_count: gaps.length,
    candidate_count: candidates.length,
    today,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'schedule_gap_check_handled', meta);
  log('schedule_gap_check_handled', meta);

  return { success: true, action: 'gaps_surfaced', gap_count: gaps.length };
}
