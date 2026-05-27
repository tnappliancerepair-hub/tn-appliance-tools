// Handles INBOUND_CALL signals (emitted by record_inbound_call_POST.xs
// from the Telnyx voice webhook handler). SMSes Teddy + Danielle with
// instant context for the inbound caller:
//
//   [ant] 📞 inbound call from Sarah Johnson (615-555-0002)
//   — refrigerator job #18095, status: scheduled, last visit 12d ago.
//   Pull up: tnapplianceexchange.net/customer-search.html?phone=…
//
// Quiet-hours suppression: don't SMS between 9pm-7am CT for calls that
// went to voicemail or rang outside business hours.
import { config } from '../config.js';
import { toOwner, toDanielle } from '../sms.js';
import { ctHour } from '../time.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

function fmtDaysAgo(ms) {
  if (!ms) return null;
  const days = Math.round((Date.now() - Number(ms)) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const phone = String(payload.caller_phone || '').trim();
  const customerId = Number(payload.customer_id || 0);
  const firstName = String(payload.first_name || '').trim();
  const lastName = String(payload.last_name || '').trim();
  const latestJobId = Number(payload.latest_job_id || 0);
  const latestStatus = String(payload.latest_job_status || '').trim();
  const latestAppliance = String(payload.latest_job_appliance || '').trim();
  const latestCreated = Number(payload.latest_job_created_at || 0);

  if (!phone) {
    await xano.markSignalProcessed(signal.id, 'inbound_call_handled', {
      outcome: 'skipped_missing_phone',
    });
    return { success: false, action: 'skipped_missing_phone' };
  }

  // Quiet hours — skip alerts at night (calls to voicemail).
  const hour = ctHour();
  if (hour < 7 || hour >= 21) {
    await xano.markSignalProcessed(signal.id, 'inbound_call_handled', {
      outcome: 'skipped_quiet_hours',
      hour_ct: hour,
      caller_phone: phone,
    });
    log('inbound_call_handled', { outcome: 'skipped_quiet_hours', hour_ct: hour });
    return { success: true, action: 'skipped_quiet_hours' };
  }

  const domain = bareDomain();
  const lookupUrl = `${domain}/customer-search.html?phone=${encodeURIComponent(phone)}`;
  const isKnown = customerId > 0;
  const name = `${firstName} ${lastName}`.trim() || (isKnown ? 'customer' : 'UNKNOWN');

  let jobClause = '';
  if (latestJobId > 0) {
    const daysAgo = fmtDaysAgo(latestCreated);
    const apClause = latestAppliance ? `${latestAppliance} ` : '';
    const statusClause = latestStatus ? `status: ${latestStatus.replace(/_/g, ' ')}` : '';
    const ageClause = daysAgo ? `last visit ${daysAgo}` : '';
    jobClause = ` — ${apClause}job #${latestJobId}, ${[statusClause, ageClause].filter(Boolean).join(', ')}.`;
  } else if (isKnown) {
    jobClause = ' — no recent job.';
  } else {
    jobClause = ' — unknown caller.';
  }

  const body = `[ant] 📞 inbound call from ${name} (${phone})${jobClause} Pull up: ${lookupUrl}`;

  let teddyRes = null;
  let danielleRes = null;
  try {
    teddyRes = await toOwner(body, {
      action: 'inbound_call_alert',
      caller_phone: phone,
      customer_id: customerId,
      latest_job_id: latestJobId,
      source_signal_id: signal.id,
    });
  } catch (err) {
    teddyRes = { success: false, error: String(err.message || err) };
  }
  try {
    danielleRes = await toDanielle(body, {
      action: 'inbound_call_alert',
      caller_phone: phone,
      customer_id: customerId,
      latest_job_id: latestJobId,
      source_signal_id: signal.id,
    });
  } catch (err) {
    danielleRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    caller_phone: phone,
    customer_id: customerId,
    matched: isKnown,
    latest_job_id: latestJobId,
    teddy_sms: teddyRes && teddyRes.success ? 'ok' : 'maybe_failed',
    danielle_sms: danielleRes && danielleRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'inbound_call_handled', meta);
  log('inbound_call_handled', meta);

  return { success: true, action: 'alerted', ...meta };
}
