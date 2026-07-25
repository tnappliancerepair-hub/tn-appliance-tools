// Vapi tool — send-quickcheck-link. When a price-shopper / "how much" caller is
// paying out of pocket, Ant fires this to TEXT them the $50 Quick Check link so
// they can self-intake (filters tire-kickers, funnels serious buyers). Texts via
// Xano send_sms (respects the customer-facing gate). Returns a spoken confirmation.
//
//   POST { phone, name? }  ->  { ok, say }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const { sendSms } = require('./_lib/sms');
const QUICK_CHECK_URL = 'https://tnapplianceexchange.net/quick-check-intake.html';
// Test phones get the $1 link (?qc=<token>); every real customer pays $50. Add
// numbers via QC_TEST_PHONES env (comma-separated) or the default set below.
// Teddy's cell is in so he can run a full call->pay test for a buck.
const QC_TEST_TOKEN = 'tn-qc-test-2026';
const TEST_PHONES = new Set(
  String(process.env.QC_TEST_PHONES || '6154855795')
    .split(',').map((s) => s.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')).filter(Boolean)
);
function linkFor(phone) {
  const d = String(phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
  return TEST_PHONES.has(d) ? (QUICK_CHECK_URL + '?qc=' + QC_TEST_TOKEN) : QUICK_CHECK_URL;
}

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
function jsonResp(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }

exports.config = { timeout: 20 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // Vapi sends tool args at the top level or under arguments/args; accept all.
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { b = {}; }
  const args = b.arguments || b.args || b;
  const phone = String(args.phone || args.number || '').trim();
  const name = String(args.name || '').trim();

  if (phone.replace(/\D/g, '').length < 10) {
    return jsonResp(200, { ok: false, say: "I didn't catch a good number to text — what's the best cell to send it to?" });
  }

  const hi = name ? ('Hi ' + name.split(/\s+/)[0] + '! ') : 'Hi! ';
  const body = hi + "Here's your $50 Quick Check from TN Appliance Exchange 🐜 — a real tech gives you an honest diagnosis and your exact options within ~2 business hours, and the $50 comes off your repair. Start here: " + linkFor(phone);

  let sent = false, gated = false;
  try {
    // tag MUST carry 'intake' so it clears the Xano send_sms intake-only gate
    // (which only passes intake/availability/media/model/video). 'quickcheck_link'
    // alone was getting dropped as non-intake → Ann "sold" the Quick Check but the
    // link never texted (Teddy 2026-07-25).
    const ok = await sendSms(phone, body, 'customer', 'quick_check_intake_link');
    sent = !!ok;
    gated = !ok; // sendSms returns false if the customer gate dropped it
  } catch (_) { sent = false; }

  // light audit (best-effort)
  const h = headers();
  if (h) {
    try {
      await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ action: 'quickcheck_link_texted', metadata: { phone, name, sent, source: 'vapi', at_ms: Date.now() } }),
      });
    } catch (_) {}
  }

  if (sent) {
    return jsonResp(200, { ok: true, say: "Perfect — I just texted you the link. Tap it and it walks you through the Quick Check in about two minutes. You'll have your honest answer and price within a couple hours." });
  }
  // gate off or send failed — still give them the verbal path so nothing's lost
  return jsonResp(200, { ok: false, say: "I'm having trouble texting right now — no worries, just head to tn appliance exchange dot net and tap Book Online. The Quick Check's right there." });
};
