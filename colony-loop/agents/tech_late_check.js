// Handles TECH_LATE_CHECK signals (emitted daily 10:15am CT by tick.js).
// For each tech whose first job today started at/before 10am CT but who
// hasn't tapped Start Job yet, sends:
//   - tech a nudge SMS with the tech-ant-live link
//   - Teddy an owner-alert
//
// Per-tech dedup via event_log compound action key — one nudge per tech
// per day max.
import { config } from '../config.js';
import { normalizeE164, toTech, toOwner } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function fmtTimeCT(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(Number(ms))).toLowerCase().replace(/\s/g, '');
  } catch { return ''; }
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let payload;
  try {
    payload = await xano.getTechsLateToFirstJob();
  } catch (err) {
    log('tech_late_check_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'tech_late_check_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed' };
  }

  const techs = (payload && payload.late_techs) || [];
  if (techs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'tech_late_check_handled', {
      outcome: 'no_late_techs',
      today_ct: payload && payload.today_ct,
    });
    log('tech_late_check_handled', { outcome: 'no_late_techs' });
    return { success: true, action: 'no_late_techs', tech_count: 0 };
  }

  const today = payload.today_ct || new Date().toISOString().slice(0, 10);
  const results = { sent: 0, skipped_dedup: 0, skipped_no_phone: 0, errors: 0 };
  const domain = bareDomain();

  for (const t of techs) {
    const techId = Number(t.tech_id);
    if (!techId) continue;

    // Per-tech-per-day dedup
    const dedupAction = `tech_late_nudge_sent_${techId}_${today}`;
    let priorSend = null;
    try {
      priorSend = await xano.getEventLogByAction(dedupAction);
    } catch (err) {
      results.errors += 1;
      continue;
    }
    if (priorSend && priorSend.exists) {
      results.skipped_dedup += 1;
      continue;
    }

    const techPhone = normalizeE164(t.tech_phone);
    if (!techPhone) {
      results.skipped_no_phone += 1;
      continue;
    }

    const techFirst = String(t.tech_first || '').trim() || 'hey';
    const custFirst = String(t.customer_first || '').trim() || 'the customer';
    const appl = String(t.appliance_type || 'appliance').toLowerCase();
    const apptStr = fmtTimeCT(t.scheduled_start);

    const techBody =
      `[ant] ${techFirst} — your first job was at ${apptStr} CT (${custFirst}, ${appl}). ` +
      `Past start time. Tap 🚗 On My Way or Start Job: ${domain}/tech-ant-live.html?job_id=${t.job_id}&tech_id=${techId}`;

    let techSms = null;
    try {
      techSms = await toTech(techPhone, techBody, {
        action: 'tech_late_nudge',
        tech_id: techId,
        job_id: t.job_id,
        scheduled_start: t.scheduled_start,
        source_signal_id: signal.id,
      });
    } catch (err) {
      techSms = { success: false, error: String(err.message || err) };
    }

    // Owner alert (consolidate — one alert listing all late techs would
    // be tidier, but the loop fires this agent once per day; simpler to
    // alert per-tech for now).
    let ownerSms = null;
    const ownerBody =
      `[ant] late: tech ${techFirst} hasn't started job #${t.job_id} ` +
      `at ${apptStr} CT (${custFirst}, ${appl}).`;
    try {
      ownerSms = await toOwner(ownerBody, {
        action: 'tech_late_owner_alert',
        tech_id: techId,
        job_id: t.job_id,
        source_signal_id: signal.id,
      });
    } catch (err) {
      ownerSms = { success: false, error: String(err.message || err) };
    }

    // Write dedup row
    try {
      await xano.recordEventLog(dedupAction, {
        tech_id: techId,
        job_id: t.job_id,
        tech_sms: techSms && techSms.success ? 'ok' : 'maybe_failed',
        owner_sms: ownerSms && ownerSms.success ? 'ok' : 'maybe_failed',
      });
      results.sent += 1;
    } catch (err) {
      results.errors += 1;
    }
  }

  await xano.markSignalProcessed(signal.id, 'tech_late_check_handled', {
    outcome: 'swept',
    tech_count: techs.length,
    today_ct: today,
    ...results,
  });
  log('tech_late_check_handled', { outcome: 'swept', tech_count: techs.length, ...results });

  return { success: true, action: 'swept', tech_count: techs.length, ...results };
}
