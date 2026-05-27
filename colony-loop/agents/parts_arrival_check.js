// Handles PARTS_ARRIVAL_CHECK signals (emitted daily at 11am CT by tick.js).
// Closes the "parts arrived but customer doesn't know to schedule" gap:
// every job in awaiting_parts status with parts_eta_date <= today gets a
// proactive SMS to the customer asking them to confirm a re-visit window.
//
// Per-job dedup via event_log action "parts_arrival_followup_sent_<job_id>_<eta>"
// so stale parts_eta_date values don't double-text. The compound key avoids
// json_decode on metadata (XS footgun: throws ERROR_FATAL on bad input).
//
// Skip cases:
//   - parts_eta_date in the future        → not arrived yet
//   - customer has no phone               → can't text
//   - already follow-up'd this eta        → dedup hit
//   - scheduling_status != awaiting_parts → already handled
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';
import { fmtCT } from '../time.js';

const APPLIANCE_NICE = {
  refrigerator: 'refrigerator', fridge: 'refrigerator', washer: 'washer',
  dryer: 'dryer', dishwasher: 'dishwasher', range: 'range', oven: 'oven',
  stove: 'stove', microwave: 'microwave',
};

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function applianceLabel(raw) {
  const k = String(raw || '').toLowerCase().trim();
  return APPLIANCE_NICE[k] || k || 'appliance';
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let due;
  try {
    due = await xano.getPartsArrivalDue();
  } catch (err) {
    log('parts_arrival_check_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'parts_arrival_check_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed', error: String(err.message || err) };
  }

  const jobs = (due && due.jobs) || [];
  if (jobs.length === 0) {
    await xano.markSignalProcessed(signal.id, 'parts_arrival_check_handled', {
      outcome: 'no_jobs_due',
      today_ct: due && due.today_ct,
    });
    log('parts_arrival_check_handled', { outcome: 'no_jobs_due', today_ct: due && due.today_ct });
    return { success: true, action: 'no_jobs_due', job_count: 0 };
  }

  const results = { sent: 0, skipped_dedup: 0, skipped_no_phone: 0, errors: 0 };
  const perJobLog = [];

  for (const j of jobs) {
    const jobId = Number(j.job_id);
    const partsEta = String(j.parts_eta_date || '');
    if (!jobId || !partsEta) continue;

    // Dedup per (job_id, parts_eta_date)
    let dedup;
    try {
      dedup = await xano.getPartsFollowupSent(jobId, partsEta);
    } catch (err) {
      results.errors += 1;
      perJobLog.push({ job_id: jobId, outcome: 'dedup_failed', error: String(err.message || err) });
      continue;
    }
    if (dedup && dedup.sent) {
      results.skipped_dedup += 1;
      continue;
    }

    const phone = normalizeE164(j.customer_phone);
    if (!phone) {
      results.skipped_no_phone += 1;
      perJobLog.push({ job_id: jobId, outcome: 'skipped_no_phone' });
      continue;
    }

    const first = String(j.customer_first || '').trim() || 'there';
    const appl = applianceLabel(j.appliance_type);
    const last4 = String(phone).replace(/\D/g, '').slice(-4);
    const portalUrl = last4
      ? `${bareDomain()}/customer-portal.html?job_id=${jobId}&last4=${last4}`
      : '';
    const portalClause = portalUrl ? ` Confirm a time: ${portalUrl}` : '';
    const body =
      `Hi ${first}, the parts for your ${appl} should have arrived. ` +
      `Reply with a day/time that works to schedule the install (or RESCHEDULE).${portalClause}`;

    let smsRes;
    try {
      smsRes = await toCustomer(phone, body, {
        action: 'parts_arrival_followup_sent',
        job_id: jobId,
        parts_eta_date: partsEta,
        source_signal_id: signal.id,
      });
    } catch (err) {
      results.errors += 1;
      perJobLog.push({ job_id: jobId, outcome: 'sms_failed', error: String(err.message || err) });
      continue;
    }

    // Write per-(job_id, eta) dedup row using compound action key.
    const dedupAction = `parts_arrival_followup_sent_${jobId}_${partsEta}`;
    try {
      await xano.recordEventLog(dedupAction, {
        job_id: jobId,
        parts_eta_date: partsEta,
        sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
        customer_phone: phone,
        source_signal_id: signal.id,
      });
      results.sent += 1;
      perJobLog.push({ job_id: jobId, outcome: 'sent' });
    } catch (err) {
      results.errors += 1;
      perJobLog.push({ job_id: jobId, outcome: 'dedup_write_failed', error: String(err.message || err) });
    }
  }

  await xano.markSignalProcessed(signal.id, 'parts_arrival_check_handled', {
    outcome: 'swept',
    today_ct: due && due.today_ct,
    job_count: jobs.length,
    sent: results.sent,
    skipped_dedup: results.skipped_dedup,
    skipped_no_phone: results.skipped_no_phone,
    errors: results.errors,
  });
  log('parts_arrival_check_handled', {
    outcome: 'swept',
    today_ct: due && due.today_ct,
    job_count: jobs.length,
    ...results,
  });
  return { success: true, action: 'swept', job_count: jobs.length, ...results };
}
