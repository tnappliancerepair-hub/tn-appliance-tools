// Handles TDR_REMINDER signals (emitted daily 4pm CT by tick.js).
// For each tech with at least one job completed today that has no/partial
// TDR, SMS them a personalized "fill before EOD" reminder with deep links.
//
// Directly attacks the TDR completeness gap that gates Phase 5A warranty
// digests. Today's reality: zero TDRs in production have all 5 fields
// filled by the assigned tech. A daily 4pm push gives techs a window to
// catch up before the warranty pipeline tries to submit.
import { config } from '../config.js';
import { normalizeE164, toTech } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function jobLabel(j) {
  const first = String(j.customer_first_name || '').trim() || 'customer';
  const appl = String(j.appliance || '').toLowerCase() || 'job';
  return `${first}'s ${appl}`;
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let payload;
  try {
    payload = await xano.getTechsWithOpenTdr();
  } catch (err) {
    log('tdr_reminder_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'tdr_reminder_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed' };
  }

  const techs = (payload && payload.techs) || [];
  if (techs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'tdr_reminder_handled', {
      outcome: 'no_open_tdrs',
      today_ct: payload && payload.today_ct,
    });
    log('tdr_reminder_handled', { outcome: 'no_open_tdrs' });
    return { success: true, action: 'no_open_tdrs', tech_count: 0 };
  }

  const results = { sent: 0, skipped_no_phone: 0, errors: 0 };
  const domain = bareDomain();

  for (const t of techs) {
    const techId = Number(t.tech_id);
    const techFirst = String(t.tech_first || '').trim() || 'hey';
    const phone = normalizeE164(t.tech_phone);
    if (!phone) {
      results.skipped_no_phone += 1;
      continue;
    }

    const jobs = t.jobs || [];
    const labels = jobs.slice(0, 4).map(jobLabel);
    const more = jobs.length > 4 ? ` + ${jobs.length - 4} more` : '';
    const first3 = jobs.slice(0, 3);
    const deepLinks = first3
      .map((j) => `tech-ant-live.html?job_id=${j.job_id}&tech_id=${techId}`)
      .join(' ');

    const body =
      `[ant] ${techFirst} — ${jobs.length} job${jobs.length === 1 ? '' : 's'} ` +
      `from today still need TDRs: ${labels.join(', ')}${more}. ` +
      `Fill before EOD: ${domain}/tech-daily-dashboard.html?tech_id=${techId}`;

    let smsRes;
    try {
      smsRes = await toTech(phone, body, {
        action: 'tdr_reminder_sent',
        tech_id: techId,
        open_job_count: jobs.length,
        source_signal_id: signal.id,
      });
      results.sent += 1;
    } catch (err) {
      results.errors += 1;
      log('tdr_reminder_sms_failed', { tech_id: techId, error: String(err.message || err) });
    }
  }

  await xano.markSignalProcessed(signal.id, 'tdr_reminder_handled', {
    outcome: 'swept',
    today_ct: payload.today_ct,
    tech_count: techs.length,
    ...results,
  });
  log('tdr_reminder_handled', {
    outcome: 'swept',
    today_ct: payload.today_ct,
    tech_count: techs.length,
    ...results,
  });
  return { success: true, action: 'swept', tech_count: techs.length, ...results };
}
