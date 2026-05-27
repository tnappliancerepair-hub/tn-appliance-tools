// Handles PROPERTY_MANAGER_ONBOARDED signals. SMSes Teddy with the new
// B2B account details for personal followup.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const payload = signal.payload || {};
  const company = String(payload.company_name || '').trim() || 'unknown';
  const contact = String(payload.contact_name || '').trim() || 'unknown';
  const phone = String(payload.phone || '').trim();
  const email = String(payload.email || '').trim();
  const units = Number(payload.unit_count || 0);
  const custId = Number(payload.customer_id || 0);

  const unitsClause = units > 0 ? ` (${units} units)` : '';
  const body =
    `[ant] 🏢 NEW B2B account: ${company}${unitsClause}. Contact: ${contact} ${phone}${email ? ' ' + email : ''}. ` +
    `Customer #${custId}. Reach out within 24h for kickoff call.`;

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'property_manager_onboarded_alert',
      customer_id: custId,
      company_name: company,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    customer_id: custId,
    outcome: smsRes && smsRes.success ? 'alerted' : 'send_failed',
  };
  await xano.markSignalProcessed(signal.id, 'property_manager_onboarded_handled', meta);
  log('property_manager_onboarded_handled', meta);
  return { success: true, action: meta.outcome };
}
