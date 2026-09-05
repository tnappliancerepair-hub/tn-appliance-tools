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
         telnyxKey, telnyxTool, telnyxProfile] = await Promise.all([
    freshSecret('PLATFORM_PHONE_LIVE'), freshSecret('PLATFORM_SIGNUP_LIVE'), freshSecret('PLATFORM_BILLING_LIVE'),
    freshSecret('PLATFORM_USAGE_DIGEST_LIVE'), freshSecret('PLATFORM_EMAIL_SECRET'),
    freshSecret('PLATFORM_STRIPE_SECRET_KEY'), freshSecret('STRIPE_SECRET_KEY'),
    freshSecret('PLATFORM_STRIPE_WEBHOOK_SECRET'), freshSecret('EMAIL_SHARED_SECRET'),
    freshSecret('EMAIL_ENABLED'), freshSecret('TN_AWS_ACCESS_KEY_ID'), freshSecret('TN_AWS_SECRET_ACCESS_KEY'),
    freshSecret('TELNYX_API_KEY'), freshSecret('TELNYX_TOOL_SECRET'), freshSecret('TELNYX_SHARED_MESSAGING_PROFILE_ID'),
  ]);
  const stripeKey = platStripe || stripe || '';
  const stripeMode = !stripeKey ? 'not_configured' : (/^sk_live_/.test(stripeKey) ? 'live' : 'test');
  const has = (v) => !!String(v || '').trim();

  // ── THE TWO GO-LIVE LANDMINES — the things that would strand a real paying signup ──
  // #1 webhook: the paid signup must fire checkout.session.completed on the SAME live account
  //    checkout charges on, into a webhook that has BOTH its signing secret AND the PLATFORM
  //    stripe key (the webhook has NO fallback to STRIPE_SECRET_KEY) — else paid-but-no-tenant.
  const webhookReady = has(platStripe) && has(whSecret);
  // #2 login email: a nicety, NOT a hard blocker — the magiclink recovery backstops it.
  const emailChainLive = has(emailShared) && truthy(emailEnabled) && has(awsId) && has(awsSecret);
  const golive = {
    signup_open: truthy(signupLive),
    stripe_mode: stripeMode,
    // Flip PLATFORM_SIGNUP_LIVE=true only once this is green (else a card gets charged for nothing).
    ready_to_flip_signup: webhookReady,
    webhook: {
      ready: webhookReady,
      platform_stripe_webhook_secret: has(whSecret) ? 'set' : 'MISSING',
      // Shape checks (prefix only, never the value) — catch the common paste-slip of putting the
      // sk_live_ key into the webhook slot. A correct webhook secret starts with whsec_.
      webhook_secret_shape: !has(whSecret) ? 'missing' : (/^whsec_/.test(String(whSecret)) ? 'whsec_ ✓ correct' : 'WRONG — not a whsec_ (re-copy the Signing secret)'),
      platform_stripe_key_shape: !has(platStripe) ? 'missing' : (/^sk_live_/.test(String(platStripe)) ? 'sk_live_ ✓ correct' : (/^sk_test_/.test(String(platStripe)) ? 'sk_test_ — TEST key, use the LIVE one' : 'unexpected prefix')),
      platform_stripe_secret_key: has(platStripe) ? 'set' : 'MISSING (webhook has no STRIPE_SECRET_KEY fallback → paid-but-no-tenant)',
      note: 'Register the endpoint in Stripe → …/.netlify/functions/platform-stripe-webhook for checkout.session.completed + customer.subscription.*',
    },
    login_email: {
      ready: emailChainLive,
      email_shared_secret: has(emailShared) ? 'set' : 'MISSING',
      email_enabled: truthy(emailEnabled) ? 'true' : 'dry-run (send-email won\'t actually send)',
      aws_ses_creds: (has(awsId) && has(awsSecret)) ? 'set' : 'MISSING',
      not_a_blocker: 'platform-provision?action=magiclink&slug=<slug>&secret=<admin> mints a fresh login on demand — no signup is ever stranded.',
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
    { key: 'signup', name: 'Public self-serve signup', state: truthy(signupLive) ? 'live' : 'gated', detail: truthy(signupLive) ? 'Open.' : 'Ready — flip on when you want strangers signing up.', flag: 'PLATFORM_SIGNUP_LIVE' },
    { key: 'annprov', name: 'Self-serve "turn on Ann"', state: truthy(phoneLive) ? 'live' : 'gated', detail: truthy(phoneLive) ? 'Buys a number + provisions.' : 'Ready — flip on to let shops buy their own line.', flag: 'PLATFORM_PHONE_LIVE' },
    { key: 'email', name: 'Warranty email intake', state: emailSecret ? 'pending' : 'pending', detail: 'Built + tested; go-live is a ~15-min Cloudflare Email Routing step (DNS), not code.', flag: 'Cloudflare DNS' },
    { key: 'overage', name: 'Ann overage billing', state: truthy(billingLive) ? 'live' : 'gated', detail: truthy(billingLive) ? 'Billing usage to Stripe.' : 'Shadow until flipped.', flag: 'PLATFORM_BILLING_LIVE' },
    { key: 'webhook', name: 'Signup webhook (provision-on-pay)', state: webhookReady ? 'live' : 'gated', detail: webhookReady ? 'A paid signup auto-creates the tenant.' : 'Set PLATFORM_STRIPE_WEBHOOK_SECRET + PLATFORM_STRIPE_SECRET_KEY (no fallback) or a paid card makes NO shop.', flag: 'PLATFORM_STRIPE_WEBHOOK_SECRET' },
    { key: 'login_email', name: 'Owner login email', state: emailChainLive ? 'live' : 'shadow', detail: emailChainLive ? 'New owners get a magic login link.' : 'Dry-run — the magiclink fallback covers it (not a hard blocker).', flag: 'EMAIL_ENABLED' },
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
