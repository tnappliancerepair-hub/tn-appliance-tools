// gmail-forward — forward an existing Gmail message (with everything in it intact) out to
// another address, from one of our own send-scoped Gmail accounts. Built so the SquareTrade
// RMA label emails can be auto-forwarded to Carrie (returns) — she gets the exact email,
// original attached as a .eml she can open + print. Uses the GMAIL{n}_* send-scoped slots
// (the "Ant Ads" web client) the same way gmail-send.js does; NOT the readonly poller token.
'use strict';
const { getSecretPreferVault } = require('./secrets');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function tokenFor(slot) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: slot.id, client_secret: slot.secret, refresh_token: slot.refresh });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('gmail token refresh failed');
  return d.access_token;
}

// Find a send-scoped Gmail slot (2..5), preferring a specific from-address (falls back to
// the first fully-configured slot so a forward still goes out from some owned account).
async function pickSlot(preferEmail) {
  let fallback = null;
  const want = String(preferEmail || '').trim().toLowerCase();
  for (let n = 2; n <= 5; n++) {
    const em = String((await getSecretPreferVault('GMAIL' + n + '_ACCOUNT_EMAIL')) || '').trim().toLowerCase();
    if (!em) continue;
    const id = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_ID')) || (await getSecretPreferVault('GOOGLE_ADS_CLIENT_ID'));
    const secret = (await getSecretPreferVault('GMAIL' + n + '_CLIENT_SECRET')) || (await getSecretPreferVault('GOOGLE_ADS_CLIENT_SECRET'));
    const refresh = await getSecretPreferVault('GMAIL' + n + '_REFRESH_TOKEN');
    if (!id || !secret || !refresh) continue;
    const slot = { em, id, secret, refresh };
    if (want && em === want) return slot;
    if (!fallback) fallback = slot;
  }
  if (fallback) return fallback;
  throw new Error('no send-scoped gmail account configured (need a GMAIL{n} slot)');
}

function encSubject(s) {
  return /[^\x00-\x7F]/.test(s) ? '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=' : s;
}
const wrap76 = (s) => String(s).replace(/(.{76})/g, '$1\r\n');

// Forward an original message (its raw base64url from Gmail get format=raw) to `to`, as a
// short note + the original attached as a .eml file. Throws on hard failure (caller wraps).
async function forwardEml({ to, subject, note, originalRawB64, filename, fromPrefer }) {
  if (!to || !originalRawB64) throw new Error('forwardEml needs to + originalRawB64');
  const slot = await pickSlot(fromPrefer || 'tnappliancerepair@gmail.com');
  const token = await tokenFor(slot);
  const boundary = 'ant_fwd_' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  const attB64 = wrap76(String(originalRawB64).replace(/-/g, '+').replace(/_/g, '/')); // base64 of original bytes
  const noteB64 = wrap76(Buffer.from(String(note || ''), 'utf8').toString('base64'));
  const fname = (filename || 'forwarded.eml').replace(/[^A-Za-z0-9._-]/g, '') || 'forwarded.eml';
  const mime =
    'From: ' + slot.em + '\r\n' +
    'To: ' + to + '\r\n' +
    'Subject: ' + encSubject(String(subject || 'Fwd:')) + '\r\n' +
    'MIME-Version: 1.0\r\n' +
    'Content-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: text/plain; charset="UTF-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    noteB64 + '\r\n\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/octet-stream; name="' + fname + '"\r\n' +
    'Content-Disposition: attachment; filename="' + fname + '"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    attB64 + '\r\n\r\n' +
    '--' + boundary + '--\r\n';
  const r = await fetch(SEND_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(mime) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('gmail send failed: ' + ((d.error && d.error.message) || ('HTTP ' + r.status)));
  return { ok: true, id: d.id, from: slot.em };
}

module.exports = { forwardEml, pickSlot };
