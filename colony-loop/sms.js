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

export async function toOwner(body, context = {}) {
  return xano.sendSms(config.ownerPhone, body, { ...context, recipient_role: 'owner' });
}

export async function toCustomer(phone, body, context = {}) {
  const e164 = normalizeE164(phone);
  if (!e164) {
    return { success: false, error: 'invalid_phone', input: phone };
  }
  return xano.sendSms(e164, body, { ...context, recipient_role: 'customer' });
}

export async function toTech(phone, body, context = {}) {
  const e164 = normalizeE164(phone);
  if (!e164) {
    return { success: false, error: 'invalid_phone', input: phone };
  }
  return xano.sendSms(e164, body, { ...context, recipient_role: 'tech' });
}
