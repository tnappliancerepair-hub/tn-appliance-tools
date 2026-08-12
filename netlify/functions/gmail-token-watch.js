// gmail-token-watch — daily safety net for the Gmail OAuth token.
//
// The pollers' refresh token dies periodically (Google force-expires test-mode
// tokens ~weekly). When it does, AHS/ServicePower warranty emails silently stop
// creating jobs in Ant — and nobody notices until the office is short jobs.
// This function checks the token once a day and TEXTS TEDDY the moment it's
// dead, so he finds out same-day instead of from missing jobs.
//
// Deliberately self-contained: it does NOT depend on Xano or the colony loop
// (both of which can be down) — it talks straight to Google + Twilio. Scheduled
// in netlify.toml.
'use strict';

const { google } = require('googleapis');

const TEDDY = '+16154855795';

// Route through send_sms (Teddy 2026-08-12 line audit) so this owner alert ships from
// the ONE approved internal line + inherits the Twilio auto-failover — instead of the
// old hardcoded unapproved 629 Twilio number.
async function textTeddy(body) {
  try {
    const r = await fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: TEDDY, message: body, context_tag: 'gmail_token_alert' }),
    });
    const d = await r.json().catch(() => ({}));
    return { sent: d && d.success === true, provider: d && d.provider };
  } catch (e) {
    return { sent: false, error: String(e.message || e) };
  }
}

// Returns { healthy:true } or { healthy:false, reason }.
async function checkGmail() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return { healthy: false, reason: 'missing_gmail_env' };
  }
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    // Real auth + API round-trip — catches invalid_grant AND scope/API problems.
    await gmail.users.getProfile({ userId: 'me' });
    return { healthy: true };
  } catch (e) {
    const msg = String((e && e.message) || e);
    const reason = /invalid_grant/i.test(msg) ? 'invalid_grant'
      : /insufficient|scope/i.test(msg) ? 'insufficient_permission'
      : msg.slice(0, 120);
    return { healthy: false, reason };
  }
}

exports.handler = async function () {
  const res = await checkGmail();
  if (res.healthy) {
    console.log(JSON.stringify({ action: 'gmail_token_watch', healthy: true }));
    return { statusCode: 200, body: JSON.stringify({ ok: true, healthy: true }) };
  }

  const body =
    `⚠️ ANT ALERT: the Gmail token is DOWN (${res.reason}). Warranty emails ` +
    `(AHS / ServicePower) are NOT creating jobs in Ant right now. ` +
    `Fix: on the Mac run  node scripts/gmail-oauth-init.js  -> update GMAIL_REFRESH_TOKEN in Netlify -> redeploy. ` +
    `(Publish the OAuth app Testing->Production to stop this for good.)`;
  const sms = await textTeddy(body);

  console.log(JSON.stringify({ action: 'gmail_token_watch', healthy: false, reason: res.reason, sms }));
  return { statusCode: 200, body: JSON.stringify({ ok: true, healthy: false, reason: res.reason, alerted: sms.sent }) };
};
