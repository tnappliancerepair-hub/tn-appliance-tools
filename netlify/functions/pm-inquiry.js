// pm-inquiry — property-management "become a preferred vendor / open a property account"
// lead. This is a B2B inquiry (a PM company, not a homeowner): captures the company +
// contact + portfolio size + markets, logs it, and texts Teddy + Danielle so a real
// person follows up fast. These are the highest-value leads we get (recurring, multi-unit),
// so they route straight to the owner. Mirrors ad-lead.js.
//
// POST { company, contact, email, phone, units, markets, message, src }
'use strict';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const { sendSms } = require('./_lib/sms');
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
async function logRow(action, metadata) {
  const h = headers(); if (!h) return;
  try { await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action, metadata }) }); } catch (_) {}
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n);

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const company = s(b.company, 120);
  const contact = s(b.contact, 80);
  const email = s(b.email, 120);
  const phone = s(b.phone, 40);
  const units = s(b.units, 40);
  const markets = s(b.markets, 200);
  const message = s(b.message, 800);
  const src = s(b.src || 'property-management', 40);
  const role = s(b.role, 60);            // e.g. Maintenance Supervisor / Community Manager
  const propertyType = s(b.property_type, 60); // e.g. Apartment community / Scattered rentals

  if (!company && !contact && !phone && !email) return jsonResp(400, { ok: false, error: 'company + a way to reach you required' });

  await logRow('pm_inquiry', { company, contact, email, phone, units, markets, message, src, role, property_type: propertyType, at_ms: Date.now() });

  // Text Teddy + Danielle — a PM/multifamily/partner account is a big recurring win, follow up fast.
  const isApt = src === 'apartment' || /apartment|multifamily|community/i.test(propertyType);
  const label = src === 'realtor' ? '🏠 REALTOR referral'
    : src === 'dealer' ? '🏬 APPLIANCE-DEALER partner'
    : isApt ? '🏢 APARTMENT/MULTIFAMILY'
    : '🏢 PROPERTY-MGMT';
  const alert = '[ant] ' + label + ' inquiry: ' + (company || '(no company)') +
    (role ? (' · ' + role) : '') + (units ? (' · ~' + units + ' units') : '') + (markets ? (' · ' + markets) : '') +
    '\nContact: ' + (contact || '(no name)') + ' ' + (phone || '') + (email ? (' · ' + email) : '') +
    (message ? ('\n"' + message.slice(0, 200) + '"') : '') + '\nCall/email them back — preferred-vendor lead.';
  try { await sendSms(OWNER, alert, 'owner', 'pm_inquiry'); } catch (_) {}
  try { await sendSms(DANIELLE, alert, 'warranty_handler', 'pm_inquiry'); } catch (_) {}

  return jsonResp(200, { ok: true });
};
