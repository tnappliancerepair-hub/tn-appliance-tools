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

// 🚚 CREW REROUTE (Teddy 2026-08-14): the Xano send_sms XS ships every internal
// recipient from the 857 tech line, and that line delivers to Teddy (an established
// contact) but NOT to the field techs — John + Jimmy both got a transfer + a live
// call but ZERO text, before OR after. The 588 CUSTOMER line, by contrast, delivers
// reliably (customers reply to it every day). So field-tech alerts now go OUT FROM
// 588, sent directly via Telnyx from Netlify (using the vaulted key) so the Xano
// tech-line classification can't override the from-number.
//   - These are ONE-WAY operational alerts (Ann's "incoming call from X", relay
//     notes, TDR nudges). A tech reply to one lands on the customer inbound handler,
//     which is fine for an alert — the conversational SAVE-your-findings TDR flow is
//     a SEPARATE Xano path (tech_job_started kickoff) and is untouched here.
//   - Opt-out is still honored. No rate-cap / quiet-hours (operational alerts).
//   - Reversible: CREW_SMS_VIA_CUSTOMER_LINE=0 restores the old 857 Xano path.
const CREW_ROLES = new Set(['technician', 'tech']);
const CREW_FROM = process.env.CREW_SMS_FROM || '+16155889500';   // 588 — the proven-deliverable line
const CREW_REROUTE_ON = String(process.env.CREW_SMS_VIA_CUSTOMER_LINE || '1') !== '0';

async function _crewSendDirect(to, body, tag) {
  let key = process.env.TELNYX_API_KEY;
  if (!key) { try { key = await require('./secrets').getSecret('TELNYX_API_KEY'); } catch (_) {} }
  if (!key) return { ok: false, error: 'no_telnyx_key' };
  try {
    const r = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: CREW_FROM, to, text: body }),
    });
    const d = await r.json().catch(() => ({}));
    const id = (d && d.data && d.data.id) || null;
    if (r.ok && id) {
      try { await require('./xano/metadata-crud').logEvent('crew_sms_from_customer_line', { to, tag: tag || '', from: CREW_FROM, id, at_ms: Date.now() }); } catch (_) {}
      return { ok: true, id };
    }
    return { ok: false, error: (JSON.stringify(d) || '').slice(0, 160), status: r.status };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
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

    // 🚚 Field-tech alerts go out from the 588 customer line (the 857 tech line
    // doesn't reach the crew). Direct Telnyx send bypasses the Xano tech-line
    // classification. Falls back to the Xano path if the key/send fails so an
    // alert is never silently dropped.
    if (CREW_REROUTE_ON && CREW_ROLES.has(r)) {
      const cr = await _crewSendDirect(to, body, tag || ('ant_' + (role || 'tech')));
      if (cr.ok) return true;
      // else fall through to the legacy Xano path below
    }

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

// Send an internal alert FROM the 588 customer line (the proven-deliverable one).
// Used for delegated dispatcher alerts (Danielle + Sofia) where the 857 tech line
// can't be trusted to land — Sofia is a fresh number, same failure class as the
// crew. Honors opt-out; falls back to the Xano/857 path if the direct send fails.
async function sendFrom588(recipient, body, tag) {
  const to = toE164(recipient);
  if (!to || to.length < 12 || !body) return false;
  try { if (await guard.isOptedOut(to)) return false; } catch (_) {}
  const cr = await _crewSendDirect(to, body, tag || 'ant_dispatch');
  if (cr.ok) return true;
  try {
    const resp = await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, body, message: body, context_tag: tag || 'ant_dispatch' }),
    });
    const d = await resp.json().catch(() => ({}));
    return !!(d && d.success);
  } catch (_) { return false; }
}

module.exports = { sendSms, toE164, sendFrom588 };
