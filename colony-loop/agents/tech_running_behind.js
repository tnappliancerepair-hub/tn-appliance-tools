// Signal in: TECH_RUNNING_BEHIND (from tech_pace_watcher)
//
// The "ultimate tech partner" — cushion-customers half. When a tech is
// running behind, look at his remaining stops today and get ahead of the
// customer experience so nobody sits wondering.
//
//   - Shadow mode (default): SMS Teddy the real list of upcoming customers
//     who'd get a heads-up, so he can validate before Ant messages anyone.
//   - Live mode (ROUTE_FILL_LIVE=true): proactively SMS the upcoming
//     customers a gentle "running a bit behind" note (still no hard time —
//     honors the day-of-window model). Bounded to the next few stops.
//     Customer sends are ALSO gated by the Xano send_sms customer gate, so
//     this stays silent until CUSTOMER_FACING_ENABLED is on too.
//
// Dedup: one behind-action per tech per hour.

import { config } from '../config.js';

const MAX_NUDGE = 3; // don't blast the whole day, just the soonest stops

function unwrap(j) { return (j && j.job) ? j.job : j; }

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;
  const p = signal.payload || {};
  const techId = p.tech_id;
  const techName = (p.tech_name || ('tech ' + techId)).trim();
  const firstName = techName.split(' ')[0] || techName;
  const minutesBehind = p.minutes_behind || 0;

  if (!techId) {
    await xano.markSignalProcessed(signal.id, 'tech_behind_handled', { outcome: 'no_tech_id' });
    return { success: false, action: 'no_tech_id' };
  }

  // Dedup — one behind-action per tech per hour
  const dedupKey = `tech_behind_alerted_${techId}`;
  try {
    const prev = await xano.getEventLogByAction(dedupKey);
    if (prev && prev.exists && prev.last_at) {
      const lastMs = new Date(prev.last_at).getTime();
      if (!isNaN(lastMs) && (Date.now() - lastMs) < 60 * 60 * 1000) {
        await xano.markSignalProcessed(signal.id, 'tech_behind_handled', { outcome: 'recent_alert_skipped' });
        return { success: true, action: 'recent_alert_skipped' };
      }
    }
  } catch (_) { /* best-effort */ }

  // Pull the day's remaining stops (not completed, not canceled, not started).
  let remaining = [];
  try {
    const dash = await xano.getTechDailyDashboard(techId);
    const items = (dash && dash.jobs) ? dash.jobs : [];
    remaining = items
      .filter(it => {
        const j = unwrap(it);
        return j && !j.job_completed_at && (j.scheduling_status || '') !== 'canceled' && !j.job_started_at;
      })
      .map(it => ({ job: unwrap(it), customer: it.customer || {} }));
  } catch (_) { remaining = []; }

  const soon = remaining.slice(0, MAX_NUDGE);

  if (!soon.length) {
    const meta = { outcome: 'no_remaining_stops', tech_id: techId, minutes_behind: minutesBehind };
    await xano.markSignalProcessed(signal.id, 'tech_behind_handled', meta);
    try { await xano.recordEventLog(dedupKey, { tech_id: techId, remaining: 0 }); } catch (_) {}
    log('tech_behind_handled', meta);
    return { success: true, action: 'no_remaining_stops' };
  }

  const listLines = soon.map((s, i) => {
    const who = (s.customer.first_name || 'customer').trim();
    const appl = (s.job.appliance_type || 'appliance').trim();
    return `${i + 1}. ${who} (${appl})`;
  }).join('\n');

  let mode, smsResult = 'skipped', nudged = 0;
  if (config.routeFillLive) {
    mode = 'nudged_customers';
    for (const s of soon) {
      const phone = (s.customer.phone || '').trim();
      const who = (s.customer.first_name || '').trim();
      if (!phone) continue;
      const body =
        `Hi${who ? ' ' + who : ''}, quick heads-up from TN Appliance — ${firstName} is running a little behind today, ` +
        `so your visit may push later. We'll text a live arrival window once he's en route. ` +
        `Reply RESCHEDULE if today no longer works.`;
      try {
        const r = await sms.toCustomer(phone, body, { action: 'tech_behind_customer_nudge', tech_id: techId, job_id: s.job.id });
        if (r?.success) nudged++;
      } catch (_) {}
    }
    smsResult = nudged > 0 ? `nudged_${nudged}` : 'none_sent_or_gated';
  } else {
    mode = 'shadow_to_owner';
    if (config.ownerPhone) {
      const body =
        `[ant] ${firstName} ${minutesBehind}min behind, ${remaining.length} stops left. Would heads-up:\n${listLines}\n` +
        `Set ROUTE_FILL_LIVE=true to let Ant message them proactively.`;
      try {
        const r = await sms.toOwner(body, { action: 'tech_behind_alert', tech_id: techId, remaining: remaining.length });
        smsResult = r?.success ? 'ok' : (r?.error || 'failed');
      } catch (e) { smsResult = String(e.message || e); }
    } else {
      smsResult = 'no_owner_phone';
    }
  }

  const meta = {
    outcome: mode,
    tech_id: techId,
    tech_name: firstName,
    minutes_behind: minutesBehind,
    remaining: remaining.length,
    nudged,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'tech_behind_handled', meta);
  try { await xano.recordEventLog(dedupKey, { tech_id: techId, minutes_behind: minutesBehind, remaining: remaining.length }); } catch (_) {}
  log('tech_behind_handled', meta);
  return { success: true, action: 'tech_behind_handled', mode };
}
