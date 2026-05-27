// Handles LICENSE_EXPIRY_CHECK signals (emitted weekly Mon 7am CT).
// For each tech with license expiring in <= 60 days, SMSes them + Teddy.
import { config } from '../config.js';
import { toOwner, toTech, normalizeE164 } from '../sms.js';

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  let payload = null;
  try {
    const res = await fetch(`${config.xanoIntakeBase}/check_license_expiry?days_ahead=60`);
    payload = await res.json();
  } catch (err) {
    await xano.markSignalProcessed(signal.id, 'license_expiry_check_handled', { outcome: 'load_failed' });
    return { success: false, action: 'load_failed' };
  }

  const expiring = (payload && payload.expiring) || [];
  if (expiring.length === 0) {
    await xano.markSignalProcessed(signal.id, 'license_expiry_check_handled', { outcome: 'no_expiring' });
    return { success: true, action: 'no_expiring' };
  }

  const lines = expiring.map(t => `• ${t.first_name} ${t.last_name}: expires ${t.license_expires_date}`);
  const ownerBody = `[ant] ⚠️ LICENSE EXPIRY (60d):\n${lines.join('\n')}`;
  try { await toOwner(ownerBody, { action: 'license_expiry_owner_alert', count: expiring.length, source_signal_id: signal.id }); }
  catch (e) { /* */ }

  for (const t of expiring) {
    const phone = normalizeE164(t.phone);
    if (!phone) continue;
    const techBody = `[ant] heads up ${t.first_name} — your license expires ${t.license_expires_date}. Renew soon to keep working.`;
    try { await toTech(phone, techBody, { action: 'license_expiry_tech_alert', tech_id: t.tech_id, source_signal_id: signal.id }); }
    catch (e) { /* */ }
  }

  const meta = { outcome: 'alerted', count: expiring.length };
  await xano.markSignalProcessed(signal.id, 'license_expiry_check_handled', meta);
  log('license_expiry_check_handled', meta);
  return { success: true, action: 'alerted', count: expiring.length };
}
