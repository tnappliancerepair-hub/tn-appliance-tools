import { config } from './config.js';
import * as xano from './xano.js';

export function normalizeE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (String(phone).startsWith('+')) return String(phone);
  return null;
}

// All sms helpers now pass company_id in context so the Xano send_sms
// endpoint can route to the per-tenant Telnyx FROM number (once the
// endpoint is refactored to read company.telnyx_from_customer /
// telnyx_from_tech instead of env vars).

export async function toOwner(body, context = {}) {
  return xano.sendSms(config.ownerPhone, body, {
    ...context, recipient_role: 'owner', company_id: config.companyId,
  });
}

export async function toDanielle(body, context = {}) {
  return xano.sendSms(config.daniellePhone, body, {
    ...context, recipient_role: 'warranty_handler', company_id: config.companyId,
  });
}

export async function toCustomer(phone, body, context = {}) {
  const e164 = normalizeE164(phone);
  if (!e164) {
    return { success: false, error: 'invalid_phone', input: phone };
  }
  return xano.sendSms(e164, body, {
    ...context, recipient_role: 'customer', company_id: config.companyId,
  });
}

export async function toTech(phone, body, context = {}) {
  const e164 = normalizeE164(phone);
  if (!e164) {
    return { success: false, error: 'invalid_phone', input: phone };
  }
  return xano.sendSms(e164, body, {
    ...context, recipient_role: 'tech', company_id: config.companyId,
  });
}
