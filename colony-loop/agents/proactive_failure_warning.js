// Handles PROACTIVE_FAILURE_WARNING signals. For a customer's known
// appliance, if predict_next_failure says we're in the 12-24 month
// window, SMS them: 'your unit is at typical failure age — want a
// preventive check?'
//
// Per-customer-per-appliance yearly dedup so we don't nag.
import { config } from '../config.js';
import { normalizeE164, toCustomer } from '../sms.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const customerId = Number(payload.customer_id || 0);
  const phone = String(payload.customer_phone || '').trim();
  const firstName = String(payload.first_name || '').trim() || 'there';
  const appliance = String(payload.appliance_type || '').trim().toLowerCase();
  const brand = String(payload.brand || '').trim();
  const installYear = Number(payload.install_year || 0);

  if (!customerId || !phone || !appliance) {
    await xano.markSignalProcessed(signal.id, 'proactive_failure_warning_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  // Check prediction
  let pred = null;
  try {
    const params = new URLSearchParams({ appliance_type: appliance });
    if (brand) params.set('brand', brand);
    if (installYear) params.set('install_year', String(installYear));
    const res = await fetch(`${config.xanoIntakeBase}/predict_next_failure?${params.toString()}`);
    pred = await res.json();
  } catch (err) {
    await xano.markSignalProcessed(signal.id, 'proactive_failure_warning_handled', { outcome: 'predict_failed' });
    return { success: false, action: 'predict_failed' };
  }

  // Only fire if we're in the 'next 12-24 months' or 'past lifespan' window
  const windowText = String(pred.next_failure_window || '');
  const inWarningWindow = /next 12-24|past typical/i.test(windowText);
  if (!inWarningWindow) {
    await xano.markSignalProcessed(signal.id, 'proactive_failure_warning_handled', {
      outcome: 'skipped_not_in_window',
      window: windowText,
    });
    return { success: true, action: 'skipped_not_in_window' };
  }

  // Yearly dedup per customer+appliance
  const dedup = `proactive_failure_warning_${customerId}_${appliance}_${new Date().getFullYear()}`;
  let prior = null;
  try { prior = await xano.getEventLogByAction(dedup); } catch (e) { /* */ }
  if (prior && prior.exists) {
    await xano.markSignalProcessed(signal.id, 'proactive_failure_warning_handled', { outcome: 'skipped_yearly_dedup' });
    return { success: true, action: 'skipped_yearly_dedup' };
  }

  const normPhone = normalizeE164(phone);
  if (!normPhone) {
    await xano.markSignalProcessed(signal.id, 'proactive_failure_warning_handled', { outcome: 'skipped_no_phone' });
    return { success: false, action: 'skipped_no_phone' };
  }

  const yearsLine = installYear > 0 ? ` (about ${pred.appliance_age_years} years old)` : '';
  const body =
    `Hi ${firstName} - your ${brand ? brand + ' ' : ''}${appliance}${yearsLine} is at the age where issues commonly start. ` +
    `Want us to do a preventive check before it fails? $99 covers it — credited toward any repair found. ` +
    `Reply YES or call 866-268-0111.`;

  let smsRes = null;
  try {
    smsRes = await toCustomer(normPhone, body, {
      action: 'proactive_failure_warning_sent',
      customer_id: customerId,
      appliance_type: appliance,
      source_signal_id: signal.id,
    });
  } catch (err) { smsRes = { success: false, error: String(err.message || err) }; }

  try {
    await xano.recordEventLog(dedup, {
      customer_id: customerId,
      appliance,
      brand,
      install_year: installYear,
      prediction_window: windowText,
      sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
    });
  } catch (e) { /* */ }

  const meta = { customer_id: customerId, outcome: smsRes && smsRes.success ? 'sent' : 'send_failed', window: windowText };
  await xano.markSignalProcessed(signal.id, 'proactive_failure_warning_handled', meta);
  log('proactive_failure_warning_handled', meta);
  return { success: true, action: meta.outcome };
}
