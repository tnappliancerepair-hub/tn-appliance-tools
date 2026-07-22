// send-tech-note — owner-gated ad-hoc text to a TEAM member (tech/office). Uses
// the internal sendSms path (role=technician) so it bypasses the customer
// intake-only gate — this is an internal message, not a customer send. Owner-only.
//   POST { secret, phone, message }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  const phone = String(b.phone || '').trim();
  const message = String(b.message || '').trim();
  if (!phone || !message) return json(400, { error: 'phone and message required' });
  try {
    const r = await sendSms(phone, message, 'technician', b.tag || 'owner_note');
    return json(200, { ok: true, result: r });
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};
