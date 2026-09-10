// platform-status — the operator health + TN-cutover-readiness truth source behind the
// System Home control tower (platform/system.html). Admin/operator-gated. Reads the real
// go-live flags from the vault, the demo tenant's live counts (service key), and returns the
// honest cutover-readiness buckets. It does NOT change anything — pure read.
//
//   ?secret=<admin>   (or Authorization: Bearer <operator supabase jwt>)
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
// This is a VERIFICATION endpoint — it must never report a stale-empty warm-container cache
// (getSecret caches even the empty case). Read env-first, then the LIVE vault, so a just-vaulted
// key shows immediately instead of "MISSING until the container recycles".
const freshSecret = async (n) => process.env[n] || (await getSecretFresh(n));
const { platform } = require('./_lib/platform-rest');

const SITE = 'https://tnapplianceexchange.net';
const OPERATOR_EMAILS = ['tnappliancerepair@gmail.com'];
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
const DEMO_OWNER_EMAIL = 'demo@assistant247.net';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function truthy(v) { return String(v || '').toLowerCase() === 'true' || String(v || '') === '1'; }

async function operatorFromJWT(event) {
  const h = event.headers || {};
  const m = String(h.authorization || h.Authorization || '').match(/Bearer\s+(.+)/i);
  if (!m) return null;
  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return OPERATOR_EMAILS.includes(String((u && u.email) || '').toLowerCase()) ? String(u.email).toLowerCase() : null;
  } catch (_) { return null; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const isAdmin = q.secret === guard || !!(await operatorFromJWT(event));
  if (!isAdmin) return { statusCode: 403, body: 'forbidden' };

  // Go-live flags (built-but-dark switches). Present them as ready-to-flip, not broken.
  const [phoneLive, signupLive, billingLive, usageDigestLive, emailSecret, platStripe, stripe,
         whSecret, emailShared, emailEnabled, awsId, awsSecret,
         telnyxKey, telnyxTool, telnyxProfile, sesProd] = await Promise.all([
    freshSecret('PLATFORM_PHONE_LIVE'), freshSecret('PLATFORM_SIGNUP_LIVE'), freshSecret('PLATFORM_BILLING_LIVE'),
    freshSecret('PLATFORM_USAGE_DIGEST_LIVE'), freshSecret('PLATFORM_EMAIL_SECRET'),
    freshSecret('PLATFORM_STRIPE_SECRET_KEY'), freshSecret('STRIPE_SECRET_KEY'),
    freshSecret('PLATFORM_STRIPE_WEBHOOK_SECRET'), freshSecret('EMAIL_SHARED_SECRET'),
    freshSecret('EMAIL_ENABLED'), freshSecret('TN_AWS_ACCESS_KEY_ID'), freshSecret('TN_AWS_SECRET_ACCESS_KEY'),
    freshSecret('TELNYX_API_KEY'), freshSecret('TELNYX_TOOL_SECRET'), freshSecret('TELNYX_SHARED_MESSAGING_PROFILE_ID'),
    freshSecret('SES_PRODUCTION_ACCESS'),
  ]);
  const stripeKey = platStripe || stripe || '';
  const stripeMode = !stripeKey ? 'not_configured' : (/^sk_live_/.test(stripeKey) ? 'live' : 'test');
  const has = (v) => !!String(v || '').trim();

  // ── THE TWO GO-LIVE LANDMINES — the things that would strand a real paying signup ──
  // #1 webhook: the paid signup must fire checkout.session.completed on the SAME live account
  //    checkout charges on, into a webhook that has its signing secret AND a stripe key. The
  //    webhook now falls back to STRIPE_SECRET_KEY the same way checkout does (2026-09-10), so
  //    either key satisfies it — but they must be the SAME account checkout charged on.
  const webhookReady = has(stripeKey) && has(whSecret);
  // #2 login email: a nicety, NOT a hard blocker — the magiclink recovery backstops it.
  //    Config being set is NOT the same as mail arriving: SES (us-east-2) starts in SANDBOX, where
  //    every unverified recipient is rejected — i.e. every real customer. Reporting this green on
  //    config alone told us the login email worked while no owner was receiving one, so production
  //    access is now part of the answer. Teddy flips SES_PRODUCTION_ACCESS once AWS grants it.
  const sesProduction = truthy(sesProd);
  const emailConfigured = has(emailShared) && truthy(emailEnabled) && has(awsId) && has(awsSecret);
  const emailChainLive = emailConfigured && sesProduction;
  const golive = {
    signup_open: true,   // fully self-serve, always open — no invite gate (Teddy 2026-09-09)
    stripe_mode: stripeMode,
    // Signup is always open; this is the payment-plumbing health that must STAY green
    // (else a paid card makes no tenant). It no longer gates signup — it's a health check.
    payment_plumbing_ready: webhookReady,
    webhook: {
      ready: webhookReady,
      platform_stripe_webhook_secret: has(whSecret) ? 'set' : 'MISSING',
      // Shape checks (prefix only, never the value) — catch the common paste-slip of putting the
      // sk_live_ key into the webhook slot. A correct webhook secret starts with whsec_.
      webhook_secret_shape: !has(whSecret) ? 'missing' : (/^whsec_/.test(String(whSecret)) ? 'whsec_ ✓ correct' : 'WRONG — not a whsec_ (re-copy the Signing secret)'),
      platform_stripe_key_shape: !has(platStripe) ? 'missing' : (/^sk_live_/.test(String(platStripe)) ? 'sk_live_ ✓ correct' : (/^sk_test_/.test(String(platStripe)) ? 'sk_test_ — TEST key, use the LIVE one' : 'unexpected prefix')),
      platform_stripe_secret_key: has(platStripe) ? 'set' : (has(stripe) ? 'not set — webhook falls back to STRIPE_SECRET_KEY (must be the SAME account checkout charges on)' : 'MISSING — no stripe key at all → paid-but-no-tenant'),
      note: 'Register the endpoint in Stripe → …/.netlify/functions/platform-stripe-webhook for checkout.session.completed + customer.subscription.*',
    },
    login_email: {
      ready: emailChainLive,
      configured: emailConfigured,
      email_shared_secret: has(emailShared) ? 'set' : 'MISSING',
      email_enabled: truthy(emailEnabled) ? 'true' : 'dry-run (send-email won\'t actually send)',
      aws_ses_creds: (has(awsId) && has(awsSecret)) ? 'set' : 'MISSING',
      ses_access: sesProduction ? 'production — any recipient' : 'SANDBOX — only verified recipients receive mail; a real customer\'s login email is REJECTED. Request production access in the AWS SES console (us-east-2), then set SES_PRODUCTION_ACCESS=true.',
      not_a_blocker: 'Every owner also gets a vaulted password (platform-provision?action=resetpw&slug=<slug>&reveal=1&once=1&secret=<admin>) and a magiclink on demand — no signup is stranded by email.',
    },
    // Ann (per-shop AI phone) creds — reports set/missing (never the values). Flip PLATFORM_PHONE_LIVE
    // + set the shared messaging profile to let shops buy their own line (buys a real DID ~$1/mo).
    phone_creds: {
      phone_live: truthy(phoneLive),
      telnyx_api_key: has(telnyxKey) ? 'set' : 'MISSING',
      telnyx_tool_secret: has(telnyxTool) ? 'set' : 'MISSING',
      telnyx_shared_messaging_profile_id: has(telnyxProfile) ? 'set' : 'MISSING',
      ready_for_ann_golive: has(telnyxKey) && has(telnyxTool) && has(telnyxProfile),
    },
  };

  // Areas: each { key, name, state, detail }. state: live | gated | shadow | pending | roadmap.
  const areas = [
    { key: 'phone', name: '24/7 phone AI (Ann)', state: 'live', detail: 'Recognizes the caller, answers from the board, books/callbacks/texts/transfers. Nightly accuracy audit.' },
    { key: 'office', name: 'Office board + dispatch', state: 'live', detail: 'Jobs, scheduling, tech assignment, invoicing, remittance.' },
    { key: 'tech', name: 'Tech app', state: 'live', detail: 'The day, the report (TDR), parts, on-my-way, get-paid.' },
    { key: 'customer', name: 'Customer portal + intake', state: 'live', detail: 'Status, two-way messages, pay by card, video/photo intake, waiver.' },
    { key: 'money', name: 'Money spine (pay + commission)', state: 'live', detail: 'Invoice → commission → payout, derived live. Warranty remittance split.' },
    { key: 'ant', name: 'AI partner (Ant) + reversible ledger', state: 'live', detail: 'Role-aware brain that acts through an undoable action log.' },
    { key: 'referral', name: 'Reseller / referral tracker', state: 'live', detail: 'Attribute referred shops to a partner, commission earned vs paid.' },
    { key: 'sp', name: 'ServicePower (per-tenant)', state: 'live', detail: 'Each shop runs ServicePower as itself. Connect live; automation shadow.' },
    { key: 'billing', name: 'Subscription billing', state: stripeMode === 'live' ? 'live' : 'gated', detail: stripeMode === 'live' ? 'Live Stripe key.' : 'Test mode until a live Stripe key + real Price IDs are vaulted.', flag: 'PLATFORM_STRIPE_SECRET_KEY' },
    { key: 'signup', name: 'Public self-serve signup', state: 'live', detail: 'Open — fully self-serve. A shop puts in its info, pays the trial, and provisions itself. No invite gate.' },
    { key: 'annprov', name: 'Self-serve "turn on Ann"', state: truthy(phoneLive) ? 'live' : 'gated', detail: truthy(phoneLive) ? 'Buys a number + provisions.' : 'Ready — flip on to let shops buy their own line.', flag: 'PLATFORM_PHONE_LIVE' },
    { key: 'email', name: 'Warranty email intake', state: emailSecret ? 'pending' : 'pending', detail: 'Built + tested; go-live is a ~15-min Cloudflare Email Routing step (DNS), not code.', flag: 'Cloudflare DNS' },
    { key: 'overage', name: 'Ann overage billing', state: truthy(billingLive) ? 'live' : 'gated', detail: truthy(billingLive) ? 'Billing usage to Stripe.' : 'Shadow until flipped.', flag: 'PLATFORM_BILLING_LIVE' },
    { key: 'webhook', name: 'Signup webhook (provision-on-pay)', state: webhookReady ? 'live' : 'gated', detail: webhookReady ? 'A paid signup auto-creates the tenant.' : 'Set PLATFORM_STRIPE_WEBHOOK_SECRET + a stripe key on the same account checkout charges on, or a paid card makes NO shop.', flag: 'PLATFORM_STRIPE_WEBHOOK_SECRET' },
    { key: 'login_email', name: 'Owner login email', state: emailChainLive ? 'live' : 'shadow',
      detail: emailChainLive ? 'New owners get a magic login link.'
        : (emailConfigured ? 'Configured, but SES is in SANDBOX — a real customer\'s login email is rejected. Owners still get in via their vaulted password + magiclink.'
                           : 'Dry-run — the vaulted password + magiclink fallback covers it (not a hard blocker).'),
      flag: emailConfigured ? 'SES_PRODUCTION_ACCESS' : 'EMAIL_ENABLED' },
  ];

  // Demo tenant sanity — proves the surfaces have real data behind them.
  let demo = { jobs: null, customers: null, techs: null, portal_url: null, verify_url: `${SITE}/platform/verify.html?slug=demo` };
  try {
    const pf = await platform();
    if (pf) {
      const co = await pf.get(`company?slug=eq.demo&select=id&limit=1`);
      const cid = co && co[0] && co[0].id;
      if (cid) {
        const [j, c, t, g] = await Promise.all([
          pf.get(`job?company_id=eq.${cid}&select=id`),
          pf.get(`customer?company_id=eq.${cid}&select=id`),
          pf.get(`technician?company_id=eq.${cid}&select=id`),
          pf.get(`portal_grant?select=token,job_id&order=created_at.desc&limit=20`),
        ]);
        demo.jobs = (j || []).length; demo.customers = (c || []).length; demo.techs = (t || []).length;
        // newest portal token whose job is in the demo company
        const demoJobIds = new Set((j || []).map((r) => r.id));
        const grant = (g || []).find((r) => demoJobIds.has(r.job_id));
        if (grant) demo.portal_url = `${SITE}/platform/portal.html?t=${grant.token}`;
      }
    }
  } catch (_) {}

  // TN-cutover readiness — honest three buckets (per Teddy's correction).
  const cutover = {
    ready: [
      '24/7 phone AI (ported — arguably ahead of the old line)',
      'Office board + dispatch + tech app + customer portal',
      'Owner numbers + pay spine + invoicing + commission',
      'AI partner + reversible action ledger',
      'Reseller / referral tracker',
      'Per-tenant ServicePower credential binding',
    ],
    remaining: [
      'Migrate the data off Xano (jobs, customers, history) — the one true blocker; can’t cut onto an empty board',
      'Confirm operational parity — run your actual day on the board, including the manual warranty processing the office does today',
      'Phone cutover — repoint the real Telnyx numbers + 10DLC SMS lanes to platform Ann (operational)',
    ],
    roadmap: [
      'Parts-ordering automation (not running on the old system either — nothing lost by switching without it)',
      'Warranty claim-submission automation (office files by hand on both systems today)',
      'AHS / Frontdoor status push (waiting on the vendor API — for both systems)',
      'Deepen the troubleshooting brain (thin cross-shop version is live; port the deep fault-code library later)',
    ],
  };

  return json(200, {
    ok: true,
    golive,
    areas,
    demo,
    demo_owner_email: DEMO_OWNER_EMAIL,
    cutover,
    seat_links: {
      owner: `${SITE}/platform/owner.html`,
      office: `${SITE}/platform/office-board.html`,
      dispatch: `${SITE}/platform/dispatch.html`,
      tech: `${SITE}/platform/tech.html`,
      customer_portal: demo.portal_url,
      customer_verify: demo.verify_url,
      operator: `${SITE}/platform/ops.html`,
      partner: `${SITE}/platform/partner.html`,
    },
  });
};
