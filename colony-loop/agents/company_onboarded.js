// Handles COMPANY_ONBOARDED signals. SMSes Teddy (platform owner)
// the new tenant + SMSes the new owner a welcome pack with admin URL.
import { config } from '../config.js';
import { toOwner, normalizeE164 } from '../sms.js';

function bareDomain() { return (config.publicSiteBase || '').replace(/^https?:\/\//, ''); }

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const companyId = Number(payload.company_id || 0);
  const name = String(payload.name || '').trim();
  const slug = String(payload.slug || '').trim();
  const ownerPhone = String(payload.owner_phone || '').trim();
  const ownerEmail = String(payload.owner_email || '').trim();

  if (!companyId) {
    await xano.markSignalProcessed(signal.id, 'company_onboarded_handled', { outcome: 'skipped_missing_payload' });
    return { success: false, action: 'skipped_missing_payload' };
  }

  const domain = bareDomain();
  const adminUrl = `${domain}/company-admin.html?company_id=${companyId}`;

  // Teddy alert (platform owner)
  const teddyBody =
    `[ant SaaS] 🎉 NEW TENANT: ${name} (slug ${slug}, id ${companyId}). ` +
    `Owner: ${ownerPhone} / ${ownerEmail}. Reach out within 24h.`;
  try { await toOwner(teddyBody, { action: 'company_onboarded_platform_alert', source_signal_id: signal.id }); }
  catch (err) { /* */ }

  // New owner welcome
  const ownerPhoneNorm = normalizeE164(ownerPhone);
  if (ownerPhoneNorm) {
    const welcomeBody =
      `🐜 Welcome to Ant - the AI-native ops platform for appliance repair. ` +
      `Your trial is live. Admin: ${adminUrl} ` +
      `Quick start: add your first tech at ${domain}/tech-onboard.html?company_id=${companyId}. ` +
      `Questions? Reply here.`;
    try {
      // Use sendSms directly (toOwner is for OUR Teddy)
      await xano.sendSms(ownerPhoneNorm, welcomeBody, {
        action: 'company_owner_welcome',
        recipient_role: 'tenant_owner',
        company_id: companyId,
        source_signal_id: signal.id,
      });
    } catch (err) { log('company_owner_welcome_failed', { company_id: companyId, error: String(err.message || err) }); }
  }

  const meta = { company_id: companyId, slug, outcome: 'welcomed' };
  await xano.markSignalProcessed(signal.id, 'company_onboarded_handled', meta);
  log('company_onboarded_handled', meta);
  return { success: true, action: 'welcomed' };
}
