// Handles CAPACITY_CHECK signals (emitted daily from tick.js at 10am CT).
// Loads today's office calendar, computes job count per tech, flags any
// tech with >6 jobs (burnout risk) or <2 jobs (idle capacity). SMSes
// Teddy when at least one threshold is breached.
//
// Skips Teddy (id=1) — he's the dispatch fallback, not a regular tech
// in the load-balance calc. Also skips inactive techs.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

const OVER_THRESHOLD = 6;  // burnout / quality-risk line
const UNDER_THRESHOLD = 2; // idle-capacity surface line

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

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let calendar;
  try {
    calendar = await xano.getOfficeCalendarWeek(null);
  } catch (err) {
    log('capacity_check_calendar_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'capacity_check_handled', { outcome: 'calendar_load_failed' });
    return { success: false, action: 'calendar_load_failed' };
  }

  const today = calendar.today_ct;
  const techs = (calendar.technicians || []).filter((t) => t && t.id && t.id !== 1 && t.active === true);
  const todayJobs = (calendar.jobs || []).filter((j) => ctDateStr(j.scheduled_start) === today && j.technician_id);

  const countByTech = {};
  for (const tech of techs) countByTech[tech.id] = 0;
  for (const j of todayJobs) {
    if (countByTech[j.technician_id] != null) countByTech[j.technician_id] += 1;
  }

  const over = [];
  const under = [];
  for (const tech of techs) {
    const c = countByTech[tech.id] || 0;
    const name = (tech.first_name || '').trim() || `Tech ${tech.id}`;
    if (c > OVER_THRESHOLD) over.push({ tech_id: tech.id, name, count: c });
    if (c < UNDER_THRESHOLD) under.push({ tech_id: tech.id, name, count: c });
  }

  if (over.length === 0 && under.length === 0) {
    const meta = { outcome: 'balanced', today, tech_count: techs.length, counts: countByTech };
    await xano.markSignalProcessed(signal.id, 'capacity_check_handled', meta);
    log('capacity_check_handled', meta);
    try { await xano.recordEventLog('capacity_check_fired', { outcome: 'balanced', today }); } catch (_) {}
    return { success: true, action: 'balanced' };
  }

  const lines = [`[ant] capacity alert (${today}):`];
  if (over.length > 0) {
    lines.push('OVER (>' + OVER_THRESHOLD + ' jobs):');
    for (const o of over) lines.push(`  ${o.name}: ${o.count} jobs`);
  }
  if (under.length > 0) {
    lines.push('UNDER (<' + UNDER_THRESHOLD + ' jobs):');
    for (const u of under) lines.push(`  ${u.name}: ${u.count} jobs`);
  }
  const bareDomain = (config.publicSiteBase || '').replace(/^https?:\/\//, '');
  lines.push(`Rebalance: ${bareDomain}/office-calendar.html?view=today`);
  const body = lines.join('\n');

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'capacity_alert',
      today,
      over_count: over.length,
      under_count: under.length,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog('capacity_check_fired', {
      today, over, under, counts: countByTech,
      sms_sent: !!(smsRes && smsRes.success),
    });
  } catch (_) { /* best effort */ }

  const meta = {
    outcome: 'alerts_sent',
    today,
    over_count: over.length,
    under_count: under.length,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'capacity_check_handled', meta);
  log('capacity_check_handled', meta);
  return { success: true, action: 'alerts_sent' };
}
