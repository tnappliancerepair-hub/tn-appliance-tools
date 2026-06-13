// Shared SMS sender for Netlify functions — routes through Xano's send_sms
// (Telnyx creds + the customer-facing gate live there; TELNYX_API_KEY is NOT in
// Netlify env). recipient_role drives gating/direction: owner / warranty_handler
// / technician bypass the customer gate; 'customer' respects CUSTOMER_FACING.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

async function sendSms(recipient, body, role, tag) {
  if (!recipient || !body) return false;
  try {
    const r = await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, body, recipient_role: role || 'owner', context_tag: tag || 'ant' }),
    });
    const d = await r.json().catch(() => ({}));
    return !!(d && d.success);
  } catch (_) { return false; }
}

module.exports = { sendSms };
