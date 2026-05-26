// Handles RESCHEDULE_REQUEST_ALERT signals (emitted by inbound_customer_sms.js
// in parallel with SMS_RESPONSE_RESCHEDULE_REQUEST — so the architect-built
// V007 responder takes the customer reply path, this agent owns the owner
// notification + audit path).
//
// SMSes Teddy + Danielle high-priority. Persists a reschedule_request_received
// row for office audit + future "open calendar reschedule modal" auto-flows.
import { config } from '../config.js';
import { toOwner, toDanielle } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id || 0);
  const customerId = Number(payload.customer_id || 0);
  const customerFirst = String(payload.first_name || '').trim().split(' ')[0] || 'customer';
  const body = String(payload.body || '').trim();
  const applianceType = String(payload.appliance_type || '').toLowerCase();

  const reviewLink = jobId
    ? `${bareDomain()}/job-detail.html?job_id=${jobId}`
    : `${bareDomain()}/office-calendar.html?view=today`;
  const ownerBody =
    `[ant] 🔄 reschedule request from ${customerFirst}` +
    (applianceType ? ` (${applianceType})` : '') +
    ` job ${jobId ? '#' + jobId : '(no active job)'}: "${body.slice(0, 120)}". ` +
    `Open: ${reviewLink}`;

  let teddyRes = null, danielleRes = null;
  try {
    teddyRes = await toOwner(ownerBody, {
      action: 'reschedule_request_alert',
      job_id: jobId,
      customer_id: customerId,
      source_signal_id: signal.id,
    });
  } catch (err) {
    teddyRes = { success: false, error: String(err.message || err) };
  }
  try {
    danielleRes = await toDanielle(ownerBody, {
      action: 'reschedule_request_alert',
      job_id: jobId,
      customer_id: customerId,
      source_signal_id: signal.id,
    });
  } catch (err) {
    danielleRes = { success: false, error: String(err.message || err) };
  }

  try {
    await xano.recordEventLog('reschedule_request_received', {
      job_id: jobId || null,
      customer_id: customerId || null,
      customer_phone: payload.customer_phone || '',
      body_preview: body.slice(0, 200),
      appliance_type: applianceType,
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('reschedule_request_persist_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const meta = {
    job_id: jobId,
    outcome: 'reschedule_alert_sent',
    teddy_sms: teddyRes && teddyRes.success ? 'ok' : 'maybe_failed',
    danielle_sms: danielleRes && danielleRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'reschedule_request_alert_handled', meta);
  log('reschedule_request_alert_handled', meta);
  return { success: true, action: 'reschedule_alert_sent', job_id: jobId };
}
