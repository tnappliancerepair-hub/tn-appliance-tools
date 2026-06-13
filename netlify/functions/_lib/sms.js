// Shared SMS sender for Netlify functions — routes through Xano's send_sms
// (Telnyx creds + the customer-facing gate live there; TELNYX_API_KEY is NOT in
// Netlify env). recipient_role drives gating/direction: owner / warranty_handler
// / technician bypass the customer gate; 'customer' respects CUSTOMER_FACING.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// send_sms input contract: `to` (phone) + `body`/`message`. Gating is by phone
// (techs/owner/Danielle are auto-detected as internal and bypass the customer
// gate). recipient_role is accepted for readability but send_sms ignores it.
async function sendSms(recipient, body, role, tag) {
  if (!recipient || !body) return false;
  try {
    const r = await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: recipient, body, message: body, context_tag: tag || ('ant_' + (role || 'sms')) }),
    });
    const d = await r.json().catch(() => ({}));
    return !!(d && d.success);
  } catch (_) { return false; }
}

module.exports = { sendSms };
