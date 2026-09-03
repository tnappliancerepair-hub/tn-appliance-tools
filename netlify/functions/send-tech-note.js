// send-tech-note — owner-gated ad-hoc text to a TEAM member (tech/office).
//
// NORMAL path: sendSms(...,'technician',...) — an internal send that bypasses the
// customer intake-only gate. It STILL honors office-gate.js, which suppresses texts
// to the 4 office cells (Danielle/Sofia/Carrie/Teddy) unless it's cash/warranty
// intake to Teddy. That's correct for day-to-day flood protection.
//
// FORCE path ({ force:true }): a deliberate one-off to an office cell (e.g. handing
// the office their new-app login). Owner-gated, sends ONE message DIRECTLY via Telnyx
// (from the proven-deliverable 588 line) — bypassing sms.js/office-gate for that single
// message only. The global OFFICE_SMS_KILL flag is untouched, so every other send stays
// gated. Opt-out is not consulted here because this is an operational, owner-initiated
// one-off; use sparingly.
//   POST { secret, phone, message, tag?, force? }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

const FORCE_FROM = process.env.CREW_SMS_FROM || '+16155889500'; // 588 — proven-deliverable Telnyx line

function toE164(p) {
  let s = String(p || '').trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const dg = s.replace(/\D/g, '');
  if (dg.length === 10) return '+1' + dg;
  if (dg.length === 11 && dg[0] === '1') return '+' + dg;
  return dg ? '+' + dg : '';
}

async function forceSend(to, body, tag) {
  let key = process.env.TELNYX_API_KEY;
  if (!key) { try { key = await getSecret('TELNYX_API_KEY'); } catch (_) {} }
  if (!key) return { ok: false, error: 'no_telnyx_key' };
  try {
    const r = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FORCE_FROM, to, text: body }),
    });
    const d = await r.json().catch(() => ({}));
    const id = (d && d.data && d.data.id) || null;
    if (r.ok && id) {
      try { await require('./_lib/xano/metadata-crud').logEvent('office_login_force_sms', { to, tag: tag || '', from: FORCE_FROM, id, at_ms: Date.now() }); } catch (_) {}
      return { ok: true, id };
    }
    return { ok: false, error: (JSON.stringify(d) || '').slice(0, 200), status: r.status };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin) return json(401, { error: 'unauthorized' });
  const phone = String(b.phone || '').trim();
  const message = String(b.message || '').trim();
  if (!phone || !message) return json(400, { error: 'phone and message required' });

  // Owner-gated surgical bypass — one direct Telnyx send, skips sms.js/office-gate.
  if (b.force === true) {
    const to = toE164(phone);
    if (!to || to.length < 12) return json(400, { error: 'bad_phone' });
    const r = await forceSend(to, message, b.tag || 'office_login');
    return json(200, { ok: !!r.ok, forced: true, result: r });
  }

  try {
    const r = await sendSms(phone, message, 'technician', b.tag || 'owner_note');
    return json(200, { ok: true, result: r });
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};
