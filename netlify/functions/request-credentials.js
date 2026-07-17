// request-credentials — the "get our W-9 + insurance" bait. A PM / apartment / realtor who
// wants our vendor paperwork is a HOT onboarding lead (they're already adding us as a
// vendor). We capture them behind a quick "let's make sure we're a fit" form, then hand
// over the packet: the page reveals it instantly on-screen, we text Teddy + Danielle the
// lead, and (once SES is enabled) we email the requester the credentials too. Made easy for
// them, captured for us.
//
//   POST { company, name, email, phone, role }  ->  { ok, packet_url, email_sent }
'use strict';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const SITE = 'https://tnapplianceexchange.net';
const { sendSms } = require('./_lib/sms');
const OWNER = '+16154855795';
const DANIELLE = '+16154850713';

function headers() { const t = process.env.XANO_METADATA_TOKEN; return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null; }
async function logRow(action, metadata) { const h = headers(); if (!h) return; try { await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, { method: 'POST', headers: h, body: JSON.stringify({ action, metadata }) }); } catch (_) {} }
function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: JSON.stringify(b) }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n);

const PACKET_URL = SITE + '/vendor-compliance.html';
const CRED_EMAIL = [
  'Thanks for adding TN Appliance Exchange as a vendor — here\'s everything you need:',
  '',
  '📄 Full compliance packet (W-9, COI/insurance, license, and a copy-paste vendor info block):',
  PACKET_URL,
  '',
  'Quick reference:',
  '• Legal name: TN Appliance Exchange LLC',
  '• EIN: 38-3886067',
  '• Address: 3137 Skinner Dr, Antioch, TN 37013',
  '• NAICS: 811412 (appliance repair) + 561790 (dryer vent cleaning)',
  '• Insurance: Hiscox (General Liability), Hartford (Workers\' Comp), Progressive (Auto)',
  '• In business since 2012 · TN + LA',
  '',
  'Need a COI naming your property as additional insured? Request it on the packet page above and we\'ll send it right over.',
  '',
  'Questions? Call or text 615-280-2949.',
  '— TN Appliance Exchange 🐜',
].join('\n');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method not allowed' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }

  const company = s(b.company, 120);
  const name = s(b.name, 80);
  const email = s(b.email, 120);
  const phone = s(b.phone, 40);
  const role = s(b.role, 60);
  if (!name || (!email && !phone)) return j(400, { ok: false, error: 'name + a way to reach you required' });

  await logRow('credentials_requested', { company, name, email, phone, role, at_ms: Date.now() });

  // HOT lead — someone onboarding us as a vendor. Straight to the owner.
  const alert = '[ant] 📄 VENDOR CREDENTIALS REQUEST — ' + (company || '(no company)') +
    (role ? (' · ' + role) : '') + '\n' + (name || '(no name)') + ' ' + phone + (email ? (' · ' + email) : '') +
    '\nThey want our W-9 + insurance to add us as a vendor — hot onboarding lead, follow up.';
  try { await sendSms(OWNER, alert, 'owner', 'credentials_request'); } catch (_) {}
  try { await sendSms(DANIELLE, alert, 'warranty_handler', 'credentials_request'); } catch (_) {}

  // Best-effort: email the requester the packet. Works the moment SES is enabled
  // (EMAIL_ENABLED=true, out of sandbox); until then send-email returns dry-run and
  // the on-screen reveal is the delivery. Either way the lead is captured.
  let emailSent = false;
  const secret = process.env.EMAIL_SHARED_SECRET;
  if (email && /.+@.+\..+/.test(email) && secret) {
    try {
      const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': secret },
        body: JSON.stringify({ to: email, subject: 'TN Appliance Exchange — our W-9, COI & insurance', body: CRED_EMAIL, cc: 'tnappliancerepair@gmail.com' }),
        signal: AbortSignal.timeout(12000),
      });
      const d = await r.json().catch(() => ({}));
      emailSent = !!(d && d.ok && d.mode === 'live');
    } catch (_) {}
  }

  return j(200, { ok: true, packet_url: PACKET_URL, email_sent: emailSent });
};
