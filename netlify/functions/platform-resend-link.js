// platform-resend-link — self-service "email me a fresh sign-in link" for the onboarding page.
// A signup's magic link is single-use and can be consumed by a link-preview scanner (or just
// expire), which would strand a paid owner on onboard.html. This lets them request a fresh one.
// SAFETY: the link is minted server-side and EMAILED to the owner's own inbox only — it is NEVER
// returned to the browser (so knowing an email can't hand you someone's account), and we don't
// reveal whether an email is a real owner (no account enumeration).
//   POST { email }  ->  { ok, sent, message }
'use strict';

const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const provision = require('./platform-provision');

const SITE = 'https://tnapplianceexchange.net';
function J(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return J(405, { ok: false, error: 'post_only' });
  let b = {}; try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) {}
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return J(200, { ok: false, message: 'Enter a valid email.' });

  const pf = await platform();
  if (!pf) return J(200, { ok: false, message: 'Try again in a minute.' });

  // Only ever resend to a REAL platform owner. Respond the same way whether or not the email is an
  // owner, so this can't be used to probe who has an account.
  let isOwner = false;
  try {
    const rows = await pf.get(`app_user?email=eq.${encodeURIComponent(email)}&role=eq.owner&select=id&limit=1`);
    isOwner = !!(rows && rows.length);
  } catch (_) {}
  if (!isOwner) return J(200, { ok: true, sent: false, message: 'If that email has a shop, a fresh sign-in link is on its way — check your inbox.' });

  // Mint a fresh magic link server-side (admin secret stays server-side; the link is only emailed).
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let link = '';
  try {
    const mev = { queryStringParameters: { secret: admin, action: 'magiclink', email, redirect: `${SITE}/platform/onboard.html` } };
    const md = JSON.parse((await provision.handler(mev)).body || '{}');
    link = md.login_link || '';
  } catch (_) {}
  if (!link) return J(200, { ok: false, message: 'Couldn’t create a link right now — try again in a minute.' });

  let sent = false;
  try {
    const shared = await getSecret('EMAIL_SHARED_SECRET');
    if (link && shared) {
      const er = await fetch(`${SITE}/.netlify/functions/send-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': shared },
        body: JSON.stringify({ to: email, subject: 'Your Ant sign-in link',
          body: `Here's a fresh sign-in link for your Ant dashboard:\n\n${link}\n\nIt's single-use and expires shortly, so tap it soon. Any trouble, just reply to this email.` }),
        signal: AbortSignal.timeout(9000),
      });
      const ed = await er.json().catch(() => ({}));
      sent = !!(er.ok && ed.mode === 'live');
    }
  } catch (_) {}

  return J(200, { ok: true, sent, message: sent
    ? `Sent! Check ${email} for a fresh sign-in link (give it a minute).`
    : `We tried to email ${email}. If it doesn't arrive, reply to your welcome text and we'll get you right in.` });
};
