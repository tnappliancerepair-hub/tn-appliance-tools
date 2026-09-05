// platform-notify — one place that pings Teddy about AssistAnt (the SaaS) events he asked to hear
// about: a shop starting a free trial, and a prospect messaging us from the site.
//
// Sends BOTH ways (his choice): an SMS to his cell (via the shared Telnyx sender — the tag must be on
// office-gate's ALLOWED_TO_TEDDY or it's silently dropped) AND an email to the operator inbox (via the
// internal send-email fn, dry-run until EMAIL_ENABLED). Best-effort throughout — it can NEVER throw and
// break the paid signup / contact flow it's called from.
'use strict';

const { sendSms } = require('./sms');
const { getSecret } = require('./secrets');

const TEDDY_CELL = '+16154855795';                    // his cell — SMS only, NEVER exposed to a customer
const OP_EMAIL = 'tnappliancerepair@gmail.com';       // operator inbox
const SITE = 'https://tnapplianceexchange.net';

// notifyOperator({ tag, sms, subject, email_body }) -> { sms:bool, email:bool, email_mode }
async function notifyOperator(opts) {
  const o = opts || {};
  const out = { sms: false, email: false, email_mode: 'skipped' };

  // 1) SMS to Teddy's cell (office-gate lets platform_signup / prospect_message through to him).
  try {
    if (o.sms) out.sms = !!(await sendSms(TEDDY_CELL, String(o.sms).slice(0, 600), 'owner', o.tag || 'platform_signup'));
  } catch (_) {}

  // 2) Email the operator inbox (gate-free; dry-run until EMAIL_ENABLED).
  try {
    const shared = await getSecret('EMAIL_SHARED_SECRET');
    if (shared && o.subject && o.email_body) {
      const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': shared },
        body: JSON.stringify({ to: OP_EMAIL, subject: String(o.subject).slice(0, 200), body: String(o.email_body).slice(0, 4000) }),
        signal: AbortSignal.timeout(9000),
      });
      const d = await r.json().catch(() => ({}));
      out.email_mode = d.mode || (r.ok ? 'sent' : 'error');
      out.email = !!(r.ok && d.mode === 'live');
    } else {
      out.email_mode = shared ? 'missing_content' : 'no_email_shared_secret';
    }
  } catch (_) { out.email_mode = 'error'; }

  return out;
}

module.exports = { notifyOperator, TEDDY_CELL, OP_EMAIL };
