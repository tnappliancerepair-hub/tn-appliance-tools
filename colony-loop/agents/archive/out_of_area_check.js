// Handles OUT_OF_AREA_CHECK signals (emitted by job_created.js when an
// AHS/ServicePower job lands in a zip not in our service_zone table).
// SMSes Teddy + Danielle a 'decline candidate' alert.
import { config } from '../config.js';
import { toOwner, toDanielle } from '../sms.js';

function bareDomain() { return (config.publicSiteBase || '').replace(/^https?:\/\//, ''); }

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const zip = String(payload.zip_code || '').trim();
  const source = String(payload.source_type || '').trim();
  const vendor = String(payload.warranty_company || '').trim();

  if (!jobId || !zip) {
    await xano.markSignalProcessed(signal.id, 'out_of_area_check_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  const dedup = `out_of_area_alert_sent_${jobId}`;
  let prior = null;
  try { prior = await xano.getEventLogByAction(dedup); } catch (e) { /* */ }
  if (prior && prior.exists) {
    await xano.markSignalProcessed(signal.id, 'out_of_area_check_handled', { outcome: 'skipped_already_alerted' });
    return { success: true, action: 'skipped_already_alerted' };
  }

  // Verify zip is really out of area
  let covered = null;
  try {
    const res = await fetch(`${config.xanoIntakeBase}/check_service_zone?zip_code=${encodeURIComponent(zip)}`);
    covered = await res.json();
  } catch (err) {
    log('out_of_area_check_zone_failed', { job_id: jobId, error: String(err.message || err) });
  }

  if (covered && covered.covered === true) {
    await xano.markSignalProcessed(signal.id, 'out_of_area_check_handled', {
      outcome: 'false_alarm_actually_covered',
      zip,
    });
    return { success: true, action: 'false_alarm_actually_covered' };
  }

  const domain = bareDomain();
  const body =
    `[ant] ⚠️ OUT OF AREA: job #${jobId} (${vendor || source} zip ${zip}). ` +
    `Decline back to vendor or expand service area. Open: ${domain}/job-detail.html?job_id=${jobId}&office=1`;

  let teddyRes = null, danielleRes = null;
  try { teddyRes = await toOwner(body, { action: 'out_of_area_alert', job_id: jobId, zip, source_signal_id: signal.id }); }
  catch (err) { teddyRes = { success: false }; }
  try { danielleRes = await toDanielle(body, { action: 'out_of_area_alert', job_id: jobId, zip, source_signal_id: signal.id }); }
  catch (err) { danielleRes = { success: false }; }

  try {
    await xano.recordEventLog(dedup, {
      job_id: jobId,
      zip,
      vendor,
      source,
      teddy_sms: teddyRes && teddyRes.success ? 'ok' : 'maybe_failed',
    });
  } catch (e) { /* */ }

  const meta = { job_id: jobId, outcome: 'alerted', zip };
  await xano.markSignalProcessed(signal.id, 'out_of_area_check_handled', meta);
  log('out_of_area_check_handled', meta);
  return { success: true, action: 'alerted' };
}
