// Generic transactional-email primitive for TN Appliance Exchange.
// Sends via AWS SES (us-east-2) from the verified domain
// noreply@tnapplianceexchange.net. Internal-auth gated (mirrors
// sign-job-token.js pattern: shared bearer secret in X-Internal-Auth
// header, timing-safe compare).
//
// Phase A1 use case: dedup-fail alerts to danielle.tnappliance@gmail.com
// from the ServicePower email intake pipeline. Future use cases include
// warranty-company portal-reply alerts, owner alerts on stuck jobs,
// daily digest emails, etc.
//
// ─── DRY-RUN MODE ─────────────────────────────────────────────────────
// When EMAIL_ENABLED env var is unset OR not the literal string "true",
// the function logs what it WOULD have sent and returns success-shaped
// {ok: true, messageId: "dry-run-not-enabled", mode: "dry-run"} WITHOUT
// calling SES. This mirrors the SMS_ENABLED pattern and lets us wire and
// test the dedup-fail path before DNS is verified. Callers don't need to
// know whether email is enabled — the contract is "ok:true with messageId,
// or ok:false with error".
//
// ─── REQUIRED ENV VARS ────────────────────────────────────────────────
//   TN_AWS_ACCESS_KEY_ID
//   TN_AWS_SECRET_ACCESS_KEY
//   EMAIL_SHARED_SECRET        // bearer for X-Internal-Auth header
//   EMAIL_ENABLED              // "true" to flip out of dry-run; anything
//                              // else (or unset) = dry-run
//
// ─── DNS REQUIREMENTS (Teddy applies before EMAIL_ENABLED="true") ─────
// See docs/servicepower-sample-offer-emails-2026-05-12.md companion docs
// or the AWS SES console (us-east-2) for the exact records. Summary:
//   1. Domain identity for tnapplianceexchange.net with EasyDKIM
//   2. 3 DKIM CNAMEs in Netlify DNS panel (values from SES console)
//   3. SPF TXT at root + at mail.tnapplianceexchange.net (MAIL FROM subdomain)
//   4. DMARC TXT at _dmarc (monitor mode initially: p=none)
//   5. MX at mail.tnapplianceexchange.net → feedback-smtp.us-east-2.amazonses.com
//   6. Verify recipient identities in SES sandbox:
//        - danielle.tnappliance@gmail.com
//        - tnappliancerepair@gmail.com
//
// Caveat for Teddy before adding the root SPF record: check Netlify DNS
// for any existing TXT record on the root domain starting with `v=spf1`.
// Only one SPF record per domain is valid. If one exists, paste it back
// and we'll merge `include:amazonses.com` into it.
//
// ─── AWS SES BOUNCE / COMPLAINT LIMITS ────────────────────────────────
// SES enforces:
//   - 5% bounce rate threshold (sustained)
//   - 0.1% complaint rate threshold (sustained)
// Exceeding either causes account-level sending suspension.
// PHASE 2 TODO: wire SES → SNS topic → Netlify function for bounce +
// complaint webhook handling so we can surface failures and clean stale
// recipients before they accumulate. For Phase A1 (low volume, single
// verified recipient) the limits still apply but monitoring is not
// load-bearing.

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const REGION = 'us-east-2';
const DEFAULT_FROM = 'noreply@tnapplianceexchange.net';
const DEFAULT_REPLY_TO = 'tnappliancerepair@gmail.com';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return cors(200, '');
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method not allowed' });

  const sharedSecret = process.env.EMAIL_SHARED_SECRET;
  const awsKeyId = process.env.TN_AWS_ACCESS_KEY_ID;
  const awsSecret = process.env.TN_AWS_SECRET_ACCESS_KEY;
  if (!sharedSecret || !awsKeyId || !awsSecret) {
    console.error('[send-email] env vars not configured (need TN_AWS_ACCESS_KEY_ID, TN_AWS_SECRET_ACCESS_KEY, EMAIL_SHARED_SECRET)');
    return json(500, { ok: false, error: 'server misconfigured' });
  }

  const providedAuth =
    event.headers['x-internal-auth'] ||
    event.headers['X-Internal-Auth'] || '';
  if (!timingSafeStringEqual(providedAuth, sharedSecret)) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return json(400, { ok: false, error: 'invalid json body' });
  }

  const { to, subject, body: emailBody, replyTo } = body;
  if (typeof to !== 'string' || !to ||
      typeof subject !== 'string' || !subject ||
      typeof emailBody !== 'string' || !emailBody) {
    return json(400, { ok: false, error: 'to + subject + body required (all non-empty strings)' });
  }

  // Dry-run mode: validate everything but never call SES. Mirrors the
  // SMS_ENABLED gate pattern. Caller sees the same success-shape contract
  // either way; only console-side logs distinguish the two paths.
  const emailEnabled = process.env.EMAIL_ENABLED === 'true';
  if (!emailEnabled) {
    console.log('[send-email] EMAIL_ENABLED=false — would have sent:', {
      to,
      subject,
      replyTo: replyTo || DEFAULT_REPLY_TO,
      body_preview: emailBody.slice(0, 200),
    });
    return json(200, { ok: true, messageId: 'dry-run-not-enabled', mode: 'dry-run' });
  }

  const ses = new SESClient({
    region: REGION,
    credentials: { accessKeyId: awsKeyId, secretAccessKey: awsSecret },
  });

  try {
    const result = await ses.send(new SendEmailCommand({
      Source: DEFAULT_FROM,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Text: { Data: emailBody, Charset: 'UTF-8' } },
      },
      ReplyToAddresses: [replyTo || DEFAULT_REPLY_TO],
    }));
    return json(200, { ok: true, messageId: result.MessageId, mode: 'live' });
  } catch (e) {
    console.error('[send-email] SES error:', e.name, e.message);
    return json(500, { ok: false, error: e.message, error_code: e.name });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function cors(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Auth',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body,
  };
}

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (_e) {
    return false;
  }
}
