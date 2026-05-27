// Handles TECH_ONBOARDED signals. SMSes the new tech a welcome pack
// + Teddy a confirmation alert.
import { config } from '../config.js';
import { toOwner, toTech, normalizeE164 } from '../sms.js';

function bareDomain() { return (config.publicSiteBase || '').replace(/^https?:\/\//, ''); }

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const techId = Number(payload.tech_id || 0);
  const firstName = String(payload.first_name || '').trim();
  const lastName = String(payload.last_name || '').trim();
  const phone = String(payload.phone || '').trim();

  if (!techId || !phone) {
    await xano.markSignalProcessed(signal.id, 'tech_onboarded_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  const domain = bareDomain();
  const normPhone = normalizeE164(phone);

  // Tech welcome pack
  if (normPhone) {
    const welcomeBody =
      `[ant] welcome to TN Appliance, ${firstName}! ` +
      `Your tech_id is ${techId}. Bookmark these:\n` +
      `• Today: ${domain}/tech-daily-dashboard.html?tech_id=${techId}\n` +
      `• Performance: ${domain}/tech-performance.html?tech_id=${techId}\n` +
      `• Payouts: ${domain}/tech-payouts.html?tech_id=${techId}\n` +
      `• Day off: ${domain}/tech-day-off.html?tech_id=${techId}\n` +
      `Teddy will set your PIN. Reply with any questions.`;
    try {
      await toTech(normPhone, welcomeBody, {
        action: 'tech_welcome_sent',
        tech_id: techId,
        source_signal_id: signal.id,
      });
    } catch (err) {
      log('tech_welcome_sms_failed', { tech_id: techId, error: String(err.message || err) });
    }
  }

  // Teddy confirmation
  const ownerBody = `[ant] ✅ new tech onboarded: ${firstName} ${lastName} (#${techId}, ${phone}). Welcome pack sent. Don't forget to set their PIN.`;
  try {
    await toOwner(ownerBody, {
      action: 'tech_onboarded_owner_alert',
      tech_id: techId,
      source_signal_id: signal.id,
    });
  } catch (err) { /* */ }

  const meta = { tech_id: techId, outcome: 'welcomed' };
  await xano.markSignalProcessed(signal.id, 'tech_onboarded_handled', meta);
  log('tech_onboarded_handled', meta);
  return { success: true, action: 'welcomed' };
}
