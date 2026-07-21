// Shared SMS sender for Netlify functions — routes through Xano's send_sms
// (Telnyx creds + the customer-facing gate live there; TELNYX_API_KEY is NOT in
// Netlify env). recipient_role drives gating/direction: owner / warranty_handler
// / technician bypass the customer gate; 'customer' respects CUSTOMER_FACING.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Xano send_sms requires E.164 ("+1XXXXXXXXXX"); a bare 10-digit number is
// rejected ("should be a single valid number"). Normalize before sending.
function toE164(p) {
  let s = String(p || '').trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d ? '+' + d : '';
}

// send_sms input contract: `to` (phone) + `body`/`message`. Gating is by phone
// (techs/owner/Danielle are auto-detected as internal and bypass the customer
// gate). recipient_role is accepted for readability but send_sms ignores it.
//
// 2026-07-02: routed through sms-guard. Internal roles (owner/tech/Danielle) send
// straight through — those alerts must never be quiet-hour'd or rate-capped.
// Customer-direction sends go through guardedSend: OPT-OUT is enforced NOW (a
// STOP'd number is never texted again — zero risk to good sends), while quiet
// hours / frequency / global-rate are shadow-logged until SMS_GUARD_ENFORCE=1.
// allowQuiet is auto-set for same-day en-route/ETA texts the customer expects.
const guard = require('./sms-guard');
const INTERNAL_ROLES = new Set(['owner', 'technician', 'tech', 'warranty_handler', 'danielle', 'office']);
// Reactive replies the customer is actively waiting on bypass quiet hours (never go
// silent on someone who just texted us). Includes the satisfaction REPLY tags
// (satisfaction_review/ask/feedback) — the 👍 link + 👎 capture — but NOT the proactive
// ask (satisfaction_check), which stays quiet-gated.
const QUIET_OK_RE = /en.?route|on.?the.?way|arriv|\beta\b|running.?late|heads.?up|satisfaction_(?:review|ask|feedback)/i;

async function sendSms(recipient, body, role, tag) {
  const to = toE164(recipient);
  if (!to || to.length < 12 || !body) return false;
  const r = String(role || '').toLowerCase();

  if (INTERNAL_ROLES.has(r)) {
    // Internal alert — send directly, but STILL honor a hard opt-out just in case
    // an internal number ever landed on the list (it won't, but it's free safety).
    try { if (await guard.isOptedOut(to)) return false; } catch (_) {}
    try {
      const resp = await fetch(`${XANO}/send_sms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, body, message: body, context_tag: tag || ('ant_' + (role || 'sms')) }),
      });
      const d = await resp.json().catch(() => ({}));
      return !!(d && d.success);
    } catch (_) { return false; }
  }

  // Customer-direction — full guard (opt-out enforced now; rest shadow until flag).
  const allowQuiet = QUIET_OK_RE.test(String(tag || '') + ' ' + String(role || ''));
  const res = await guard.guardedSend({ phone: to, message: body, tag: tag || ('ant_' + (role || 'sms')), kind: role || 'customer', allowQuiet });
  return res.sent;
}

module.exports = { sendSms, toE164 };
