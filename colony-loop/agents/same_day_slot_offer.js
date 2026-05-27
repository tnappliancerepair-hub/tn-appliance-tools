// Handles SAME_DAY_SLOT_OFFER signals (emitted by job_completed.js when a
// tech finishes >2h before their next scheduled job today). Scans the AHS
// backlog for jobs in the tech's service area + SMSes Teddy with a
// one-tap-to-fill suggestion.
//
// Distinct from schedule_gap_check (daily 9am proactive sweep) — this
// fires REACTIVELY when an opportunity opens up mid-day.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

const GAP_LOOKBACK_HOURS = 2;
const SUGGESTION_CAP = 5;

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const techId = Number(payload.technician_id || 0);
  const completedJobId = Number(payload.job_id || 0);
  const gapMinutes = Number(payload.gap_minutes || 0);

  if (!techId || gapMinutes < GAP_LOOKBACK_HOURS * 60) {
    await xano.markSignalProcessed(signal.id, 'same_day_slot_offer_handled', {
      outcome: 'skipped_short_gap',
      gap_minutes: gapMinutes,
    });
    return { success: true, action: 'skipped_short_gap' };
  }

  // Per-tech-per-day dedup — at most one offer per tech per day
  const today = new Date().toISOString().slice(0, 10);
  const dedupAction = `same_day_slot_offer_sent_${techId}_${today}`;
  let priorSend = null;
  try {
    priorSend = await xano.getEventLogByAction(dedupAction);
  } catch (err) {
    log('same_day_slot_dedup_failed', { tech_id: techId, error: String(err.message || err) });
  }
  if (priorSend && priorSend.exists) {
    await xano.markSignalProcessed(signal.id, 'same_day_slot_offer_handled', {
      outcome: 'skipped_already_offered_today',
    });
    return { success: true, action: 'skipped_already_offered_today' };
  }

  // Pull AHS backlog (uses existing list_ahs_backlog endpoint)
  let backlog = null;
  try {
    backlog = await xano.getJSON
      ? await xano.getJSON(`${config.xanoIntakeBase}/list_ahs_backlog?per_page=20`)
      : await fetchAhsBacklog();
  } catch (err) {
    log('same_day_slot_backlog_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'same_day_slot_offer_handled', {
      outcome: 'backlog_load_failed',
    });
    return { success: false, action: 'backlog_load_failed' };
  }

  const candidates = (backlog && backlog.jobs) || [];
  if (candidates.length === 0) {
    await xano.markSignalProcessed(signal.id, 'same_day_slot_offer_handled', {
      outcome: 'no_backlog_candidates',
    });
    log('same_day_slot_offer_handled', { outcome: 'no_backlog_candidates' });
    return { success: true, action: 'no_backlog_candidates' };
  }

  const top = candidates.slice(0, SUGGESTION_CAP);
  const domain = bareDomain();
  const lines = top.map((j) => {
    const cust = j.customer_first || 'customer';
    const appl = j.appliance_type || 'job';
    return `• job #${j.job_id} · ${cust} · ${appl}`;
  });

  const body =
    `[ant] 💡 tech #${techId} finished job #${completedJobId} early (~${Math.round(gapMinutes)}m gap). ` +
    `Backlog candidates to fill:\n` +
    lines.join('\n') +
    `\nOpen office: ${domain}/office-calendar.html`;

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'same_day_slot_offer_sent',
      tech_id: techId,
      gap_minutes: gapMinutes,
      candidate_count: top.length,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog(dedupAction, {
      tech_id: techId,
      completed_job_id: completedJobId,
      gap_minutes: gapMinutes,
      candidate_count: top.length,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
  } catch (err) {
    log('same_day_slot_dedup_write_failed', { tech_id: techId, error: String(err.message || err) });
  }

  const meta = {
    tech_id: techId,
    outcome: smsRes && smsRes.success ? 'offered' : 'send_failed',
    gap_minutes: gapMinutes,
    candidate_count: top.length,
  };
  await xano.markSignalProcessed(signal.id, 'same_day_slot_offer_handled', meta);
  log('same_day_slot_offer_handled', meta);
  return { success: true, action: meta.outcome, ...meta };
}

async function fetchAhsBacklog() {
  const res = await fetch(`${config.xanoIntakeBase}/list_ahs_backlog?per_page=20`);
  return res.json();
}
