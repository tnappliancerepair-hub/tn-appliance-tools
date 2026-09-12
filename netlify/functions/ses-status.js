// SES account + identity diagnostic — READ ONLY. Owner-gated.
//
// WHY THIS EXISTS (2026-09-12): the AWS console login was blocked (dual
// account confusion between tnappliancerepair@ and tnappliance@, plus an
// AWS Builder ID vs root-user mixup). But we already hold working SES API
// credentials in Netlify env, so every question we needed the console for
// is answerable over the API instead:
//
//   * WHICH AWS ACCOUNT are our keys on?  -> the identity list. Whichever
//     account holds tnapplianceexchange.net is the one that matters; the
//     email you sign in with is irrelevant as long as these keys work.
//   * IS DKIM ACTUALLY REVOKED?  -> DkimVerificationStatus per identity.
//     (AWS mailed SUCCESS 5/13 -> DISABLED 5/19 -> REVOKED 5/24, us-east-2.)
//   * ARE WE STILL IN THE SANDBOX?  -> Max24HourSend. Sandbox is 200/day;
//     production is 50,000+. This is the gate on real signup login emails.
//
// This function NEVER writes. It cannot enable sending, cannot request
// production access, cannot change DNS. It only reports.
//
// Verify: ses-status?secret=<VAPI_ADMIN_SECRET>

const {
  SESClient,
  GetSendQuotaCommand,
  GetAccountSendingEnabledCommand,
  ListIdentitiesCommand,
  GetIdentityVerificationAttributesCommand,
  GetIdentityDkimAttributesCommand,
  GetIdentityMailFromDomainAttributesCommand,
} = require('@aws-sdk/client-ses');
const { getSecret } = require('./_lib/secrets');

const REGION = 'us-east-2';

function mask(v) {
  const s = String(v || '');
  if (!s) return null;
  return s.length <= 4 ? '****' : '****' + s.slice(-4);
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) {
    return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'forbidden' }) };
  }

  // Env first (that's where send-email reads them), vault as fallback so a
  // future move off the 4KB Netlify env budget doesn't silently break this.
  const keyId = process.env.TN_AWS_ACCESS_KEY_ID || (await getSecret('TN_AWS_ACCESS_KEY_ID')) || '';
  const secret = process.env.TN_AWS_SECRET_ACCESS_KEY || (await getSecret('TN_AWS_SECRET_ACCESS_KEY')) || '';

  if (!keyId || !secret) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: false,
        error: 'aws_creds_missing',
        note: 'TN_AWS_ACCESS_KEY_ID / TN_AWS_SECRET_ACCESS_KEY are not readable from this function.',
        region: REGION,
      }, null, 2),
    };
  }

  const ses = new SESClient({ region: REGION, credentials: { accessKeyId: keyId, secretAccessKey: secret } });
  const out = {
    ok: true,
    region: REGION,
    access_key_id: mask(keyId),
    checked_at: new Date().toISOString(),
  };
  const errs = {};

  const safe = async (label, fn) => {
    try { return await fn(); }
    catch (e) { errs[label] = String((e && e.message) || e).slice(0, 300); return null; }
  };

  // --- account posture -------------------------------------------------
  const quota = await safe('quota', () => ses.send(new GetSendQuotaCommand({})));
  if (quota) {
    const max = Number(quota.Max24HourSend || 0);
    out.account = {
      max_24h_send: max,
      max_send_rate_per_sec: quota.MaxSendRate,
      sent_last_24h: quota.SentLast24Hours,
      // 200/day is the documented SES sandbox cap. Anything above it means
      // production access already landed.
      sandbox: max > 0 && max <= 200,
    };
  }
  const sending = await safe('sending_enabled', () => ses.send(new GetAccountSendingEnabledCommand({})));
  if (sending) out.account = Object.assign(out.account || {}, { sending_enabled: !!sending.Enabled });

  // --- which identities live on THIS account (= which account we're on) --
  const ids = await safe('identities', () => ses.send(new ListIdentitiesCommand({ MaxItems: 100 })));
  const identities = (ids && ids.Identities) || [];
  out.identity_count = identities.length;
  out.identities = identities;

  if (identities.length) {
    const ver = await safe('verification', () =>
      ses.send(new GetIdentityVerificationAttributesCommand({ Identities: identities })));
    const dkim = await safe('dkim', () =>
      ses.send(new GetIdentityDkimAttributesCommand({ Identities: identities })));
    const domains = identities.filter((i) => !i.includes('@'));
    const mf = domains.length
      ? await safe('mail_from', () =>
          ses.send(new GetIdentityMailFromDomainAttributesCommand({ Identities: domains })))
      : null;

    out.detail = identities.map((id) => {
      const v = ((ver && ver.VerificationAttributes) || {})[id] || {};
      const d = ((dkim && dkim.DkimAttributes) || {})[id] || {};
      const m = ((mf && mf.MailFromDomainAttributes) || {})[id] || {};
      const row = {
        identity: id,
        kind: id.includes('@') ? 'email' : 'domain',
        verification: v.VerificationStatus || null,
        dkim_enabled: typeof d.DkimEnabled === 'boolean' ? d.DkimEnabled : null,
        dkim_status: d.DkimVerificationStatus || null,
      };
      if (d.DkimTokens && d.DkimTokens.length) {
        // The CNAME hosts we need in DNS. Values are public DNS data, not secrets.
        row.dkim_cnames = d.DkimTokens.map((t) => ({
          host: `${t}._domainkey.${id}`,
          points_to: `${t}.dkim.amazonses.com`,
        }));
      }
      if (m.MailFromDomain) {
        row.mail_from = {
          domain: m.MailFromDomain,
          status: m.MailFromDomainStatus || null,
          on_mx_failure: m.BehaviorOnMXFailure || null,
        };
      }
      return row;
    });

    const primary = out.detail.find((r) => r.identity === 'tnapplianceexchange.net');
    out.primary_domain_ok = !!(primary
      && primary.verification === 'Success'
      && primary.dkim_status === 'Success');
    if (primary) out.primary_domain = primary;
  }

  if (Object.keys(errs).length) out.errors = errs;

  // The AccessDenied messages carry the caller's full ARN, which is the one
  // thing they DO tell us for free: the account id and the IAM user. Surface
  // it as data — it is what resolves "which AWS account do I sign in to".
  for (const m of Object.values(errs)) {
    const hit = /arn:aws:iam::(\d+):user\/(\S+?)\s/.exec(String(m) + ' ');
    if (hit) { out.aws_account_id = hit[1]; out.iam_user = hit[2]; break; }
  }

  // --- plain-English verdict ------------------------------------------
  // GUARDRAIL (2026-09-12): the first cut of this computed an empty blockers
  // array and therefore reported "production-ready" when every read had in
  // fact failed with AccessDenied. That is the same class of bug as a guard
  // keyed on a field that is structurally always empty: it looked green
  // because it learned NOTHING, not because anything was verified. A verdict
  // now requires evidence, and absence of evidence reports as UNKNOWN.
  const readAccount = !!out.account;
  const readIdentities = !errs.identities;
  out.read_access = { account: readAccount, identities: readIdentities };

  if (!readAccount && !readIdentities) {
    out.blockers = ['cannot read SES state — these credentials are send-only'];
    out.verdict = 'UNKNOWN — the IAM user has ses:SendEmail but no ses:Get*/ses:List* permission, so nothing about DKIM, the sandbox, or the identity list could be verified. This is NOT a clean bill of health.';
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(out, null, 2) };
  }

  const blockers = [];
  const unknowns = [];
  if (readAccount) {
    if (out.account.sending_enabled === false) blockers.push('account sending is DISABLED');
    if (out.account.sandbox) blockers.push('still in the SES sandbox (200/day, verified recipients only)');
  } else {
    unknowns.push('send quota / sandbox state');
  }
  if (readIdentities) {
    if (!identities.length) blockers.push('this account has NO SES identities at all');
    else if (!out.primary_domain_ok) {
      const p = out.primary_domain;
      if (!p) blockers.push('tnapplianceexchange.net is NOT an identity on this account');
      else blockers.push(`tnapplianceexchange.net verification=${p.verification} dkim=${p.dkim_status}`);
    }
  } else {
    unknowns.push('identity + DKIM status');
  }
  out.blockers = blockers;
  out.unknowns = unknowns;
  out.verdict = blockers.length
    ? 'NOT ready to send real login emails — ' + blockers.join(' · ')
    : (unknowns.length
        ? 'PARTIAL — nothing failed in what could be read, but these were unreadable: ' + unknowns.join(' · ')
        : 'SES is production-ready for tnapplianceexchange.net');

  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(out, null, 2) };
};
