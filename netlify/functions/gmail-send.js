// gmail-send — let Ant compose + send (or draft) email from Teddy's own Gmail accounts
// (Teddy 2026-08-13: "I'd like you to send emails for me — tnappliance, tnappliancerepair,
// and my personal one"). Uses the send-scoped refresh tokens minted via gmail2-oauth-start
// (GMAIL{n}_REFRESH_TOKEN, all under the "Ant Ads" WEB client). DRAFTS-FIRST by default:
// Ant writes the email straight into the right Gmail account (in-thread when replying) and
// Teddy taps Send — nothing goes out under his name unless he says "send" (send:true).
//
//   POST { secret, from|slot, to, subject, body, thread_id?, send? }
//     from      — the account to send AS (e.g. "tnappliance@gmail.com"); or slot 2..5
//     send      — false/omitted = create a DRAFT (default); true = actually send
//     thread_id — optional Gmail thread id to reply within (keeps it in the conversation)
//   -> { ok, mode:'draft'|'sent', from, id, thread_id }
'use strict';

const { getSecretPreferVault } = require('./_lib/secrets');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }
const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Which vault slot holds the send token for a given "from" address.
async function resolveSlot(from, slot) {
  if (slot && Number(slot) >= 2 && Number(slot) <= 5) return Number(slot);
  const want = String(from || '').trim().toLowerCase();
  if (!want) return 0;
  for (let n = 2; n <= 5; n++) {
    const em = String((await getSecretPreferVault('GMAIL' + n + '_ACCOUNT_EMAIL')) || '').trim().toLowerCase();
    if (em && em === want) return n;
  }
  return 0;
}

async function accessToken(n) {
  const id = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_ID')) || (await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'));
  const secret = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_SECRET')) || (await getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET'));
  const refresh = await getSecretPreferVault('GMAIL' + n + '_REFRESH_TOKEN');
  if (!id || !secret || !refresh) throw new Error('slot ' + n + ' not fully configured (client id/secret/refresh)');
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: id, client_secret: secret, refresh_token: refresh });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('token refresh failed: ' + JSON.stringify(d).slice(0, 200));
  return d.access_token;
}

// For a clean reply: pull the last message's Message-ID + Subject off the thread.
async function threadReplyHeaders(tok, threadId) {
  try {
    const r = await fetch(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`, { headers: { Authorization: 'Bearer ' + tok } });
    const d = await r.json().catch(() => ({}));
    const msgs = (d && d.messages) || [];
    const last = msgs[msgs.length - 1];
    const hs = ((last && last.payload && last.payload.headers) || []);
    const get = (name) => (hs.find((h) => String(h.name).toLowerCase() === name) || {}).value || '';
    return { messageId: get('message-id'), subject: get('subject') };
  } catch (_) { return { messageId: '', subject: '' }; }
}

exports.config = { timeout: 22 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const guard = (await getSecretPreferVault('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (String(b.secret || '') !== guard) return j(403, { ok: false, error: 'forbidden' });

  const to = String(b.to || '').trim();
  const bodyText = String(b.body || '');
  if (!to || !bodyText) return j(400, { ok: false, error: 'need to + body' });

  const n = await resolveSlot(b.from, b.slot);
  if (!n) return j(400, { ok: false, error: 'unknown from-account — pass a connected from= address or slot=2..5' });

  let tok;
  try { tok = await accessToken(n); } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
  const from = String((await getSecretPreferVault('GMAIL' + n + '_ACCOUNT_EMAIL')) || b.from || '').trim();

  let subject = String(b.subject || '').trim();
  const headers = [];
  const threadId = String(b.thread_id || '').trim();
  if (threadId) {
    const rh = await threadReplyHeaders(tok, threadId);
    if (!subject && rh.subject) subject = /^re:/i.test(rh.subject) ? rh.subject : ('Re: ' + rh.subject);
    if (rh.messageId) { headers.push('In-Reply-To: ' + rh.messageId); headers.push('References: ' + rh.messageId); }
  }
  if (!subject) subject = '(no subject)';

  const mime = [
    'From: ' + from,
    'To: ' + to,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ].concat(headers).join('\r\n') + '\r\n\r\n' + bodyText;
  const raw = b64url(mime);
  const payload = threadId ? { raw, threadId } : { raw };

  const send = b.send === true || b.send === 'true';
  const url = send ? `${GMAIL}/messages/send` : `${GMAIL}/drafts`;
  const outBody = send ? payload : { message: payload };
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(outBody) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return j(200, { ok: false, error: (d && d.error && d.error.message) || ('HTTP ' + r.status), detail: d });
    const msg = send ? d : (d.message || {});
    return j(200, { ok: true, mode: send ? 'sent' : 'draft', from, to, subject, id: msg.id || d.id, thread_id: msg.threadId || threadId || '' });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
