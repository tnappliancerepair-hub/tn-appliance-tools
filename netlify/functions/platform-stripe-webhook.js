// platform-stripe-webhook — the flip switch for the SaaS. When a shop's subscription is
// created / updated / canceled, this maps the subscription back to the company and flips
// company.plan / company.status / company.features automatically, so the surfaces show
// exactly what the shop pays for. OUR billing relationship with the shop; never touches the
// shop's own customer money.
//
// Stripe setup (owner, once): Developers -> Webhooks -> add endpoint
//   https://tnapplianceexchange.net/.netlify/functions/platform-stripe-webhook
//   events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
// Store its signing secret in the vault as PLATFORM_STRIPE_WEBHOOK_SECRET (whsec_...).
'use strict';

const Stripe = require('stripe');
const plans = require('../../platform/plans.js');
const { getSecret, criticalSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');
const { applyEntitlement } = require('./_lib/platform-features');

// Map a set of Stripe Price ids on the subscription -> which catalog module keys they are.
// Real Price ids resolve via the vaulted STRIPE_PRICE_* the catalog references; that mapping
// is built once per invocation. Ephemeral test prices (no vaulted id) fall back to the
// subscription's own metadata.plan / metadata.addons (set at checkout).
async function catalogPriceMap() {
  const map = {}; // stripe_price_id -> module key
  const all = plans.PLANS.concat(plans.ADDONS);
  for (const m of all) {
    if (!m.price_env) continue;
    const id = String((await getSecret(m.price_env)) || '').trim();
    if (id) map[id] = m.key;
  }
  return map;
}

function subStatusToCompanyStatus(s) {
  // Stripe sub status -> our company.status lifecycle
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete') return 'past_due';
  if (s === 'canceled' || s === 'incomplete_expired') return 'canceled';
  return 'active';
}

async function resolveEntitlement(sub, priceMap) {
  // Derive plan + add-on keys from the subscription's active items.
  const items = (sub.items && sub.items.data) || [];
  const keys = [];
  for (const it of items) {
    const pid = it.price && it.price.id;
    if (pid && priceMap[pid]) keys.push(priceMap[pid]);
  }
  // Fallback for ephemeral/test prices: read what checkout stamped on the sub metadata.
  if (!keys.length && sub.metadata) {
    if (sub.metadata.plan) keys.push(sub.metadata.plan);
    (String(sub.metadata.addons || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)).forEach(function (k) { keys.push(k); });
  }
  const planKeys = keys.filter(function (k) { return plans.PLANS.some(function (p) { return p.key === k; }); });
  const addonKeys = keys.filter(function (k) { return plans.ADDONS.some(function (a) { return a.key === k; }); });
  return { planKey: planKeys[0] || null, addons: addonKeys };
}

async function findCompanyId(pf, sub, session) {
  // Prefer explicit company_id metadata; else look up by stripe customer/subscription id.
  const meta = (sub && sub.metadata) || (session && session.metadata) || {};
  if (meta.company_id) return meta.company_id;
  const custId = (sub && sub.customer) || (session && session.customer);
  if (custId) {
    const rows = await pf.get(`company?stripe_customer_id=eq.${encodeURIComponent(custId)}&select=id&limit=1`);
    if (rows && rows[0]) return rows[0].id;
  }
  const subId = sub && sub.id;
  if (subId) {
    const rows = await pf.get(`company?stripe_subscription_id=eq.${encodeURIComponent(subId)}&select=id&limit=1`);
    if (rows && rows[0]) return rows[0].id;
  }
  return null;
}

const SITE = 'https://tnapplianceexchange.net';
const provision = require('./platform-provision');

// Provisioning + crew-pack minting does ~20 sequential Supabase calls; give it the full window so
// a self-serve signup never times out mid-provision. (The redirect path platform-signup-verify is
// already 26s; this matches it for the webhook path.)
exports.config = { timeout: 26 };

// Stand up a tenant from the checkout metadata (called after the card clears), stamp the new
// company_id onto the Stripe subscription so later subscription.* events map, and email the
// owner a one-tap login link. Returns the new company_id (or null on failure).
async function provisionFromMeta(pf, stripe, sub, meta) {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const email = String(meta.email || '').trim().toLowerCase();
  let slug = String(meta.slug || '').trim();
  if (!slug || !email) return null;
  // Referral attribution — only credit a code that matches a real ACTIVE partner (a stray
  // ?ref= from the URL must not attribute to a nobody). Validated via the service key.
  let refCode = '';
  const rawRef = String(meta.ref || '').trim();
  if (rawRef) {
    try {
      const pr = await pf.get(`partner?code=eq.${encodeURIComponent(rawRef)}&active=eq.true&select=code&limit=1`);
      if (pr && pr[0] && pr[0].code) refCode = pr[0].code;
    } catch (_) {}
  }
  const pev = { queryStringParameters: {
    secret: admin, slug, name: meta.name || slug, trade: meta.trade || 'appliance',
    plan: meta.plan || 'office', owner_email: email, owner_name: meta.owner_name || '', owner_phone: meta.owner_phone || '',
    ref: refCode,
  } };
  // Provisioning creates the owner's auth login THEN the company; it isn't atomic, so a transient
  // hiccup (or an existing/orphaned auth user from a prior attempt) can leave the FIRST try not-ok
  // while having already created the auth user. Retry once — the second pass sees the existing user
  // and completes the company (this is exactly the manual recovery that un-strands a paid signup).
  // provision is idempotent by slug, so a retry never double-creates.
  let pd = {};
  for (let attempt = 0; attempt < 2 && !(pd.ok && pd.company); attempt++) {
    try { pd = JSON.parse((await provision.handler(pev)).body || '{}'); } catch (_) { pd = {}; }
    // provision marks a failure it KNOWS is deterministic (retryable:false) -- e.g. the owner's
    // email already owns another shop, which app_user.auth_user_id's UNIQUE constraint makes
    // permanent. Grinding a second inline pass on that just burns a round trip. (2026-09-12)
    if (pd && pd.retryable === false) break;
  }
  // A deterministic failure must NOT ask Stripe to re-deliver: every redelivery fails identically,
  // re-alerts the operator, and buys nothing for ~3 days until Stripe gives up. Accept the event,
  // tell the operator once, and say plainly that this one needs a human. (2026-09-12)
  const deterministic = !!(pd && pd.retryable === false);
  // A PAID signup must NEVER strand silently. If both tries fail, alert the operator on the spot
  // (text + email, the platform_signup tag reaches Teddy's cell) with the one-line recovery command.
  if (!pd.ok || !pd.company) {
    console.error('[platform-stripe-webhook] provision failed', pd && pd.error);
    try {
      const notify = require('./_lib/platform-notify');
      const err = String((pd && pd.error) || 'unknown');
      await notify.notifyOperator({
        tag: 'platform_signup',
        sms: deterministic
          ? `⚠️ PAID SIGNUP NEEDS YOU: ${meta.name || slug} (${email}) paid but CANNOT be set up automatically — ${pd.message || err}. This will NOT retry or fix itself. Refund or re-run the signup on a different email.`
          : `⚠️ PAID SIGNUP STRANDED: ${meta.name || slug} (${email}) paid but couldn't be set up (${err}). Stripe will re-deliver and we retry automatically — if you get this again in an hour, recover it: check /shops or ask Ant to provision ${slug}.`,
        subject: `⚠️ Paid signup stranded — ${meta.name || slug}`,
        email_body: (deterministic
          ? `A shop PAID but CANNOT be provisioned, and this will not fix itself.\n\nReason: ${pd.message || err}\n\nThis is a permanent condition, not a hiccup -- Stripe is NOT being asked to re-deliver, because every retry would fail the same way. A human has to act: either refund the subscription, or have them sign up again on an email that does not already own a shop.`
          : `A shop PAID but provisioning failed, so the owner has NO dashboard right now.\n\nStripe will re-deliver this event and we retry automatically, so this may clear itself within minutes. If you receive this alert repeatedly, it is NOT clearing — recover it by hand.\n\nShop: ${meta.name || slug}\nEmail: ${email}\nSlug: ${slug}\nError: ${err}\n\nRecover: ${SITE}/.netlify/functions/platform-provision?action=provision&secret=<admin>&slug=${slug}&owner_email=${encodeURIComponent(email)}&name=${encodeURIComponent(meta.name || slug)}&trade=${meta.trade || 'appliance'}&plan=${meta.plan || 'office'}\nThen mint a magiclink (action=magiclink&email=${encodeURIComponent(email)}) and send it to them.`),
      });
    } catch (_) {}
    // Throw (not return-null) so the handler can answer Stripe with a non-2xx and Stripe
    // RE-DELIVERS this event. Both inline retries just failed, which is almost always transient
    // (Supabase/auth blip) — a redelivery minutes later is how the paid shop un-strands itself.
    // provision is idempotent by slug, so a redelivery never double-creates. (2026-09-10)
    if (deterministic) {
      // 2xx = "delivered, stop resending". The operator has been told, once, in plain words.
      return null;
    }
    const perr = new Error('provision_failed');
    perr.retryable = true;
    throw perr;
  }
  const companyId = pd.company.id;
  // Follow the slug provision ACTUALLY used. Its collision guard hands back a fresh slug when the
  // one signup stamped into Stripe metadata already belongs to a different owner (two shops, same
  // name). Everything below keys off slug — the crew pack most of all — so staying on the metadata
  // slug here would build this owner's team inside the other shop. (2026-09-10)
  if (pd.company.slug && pd.company.slug !== slug) {
    console.warn('[platform-stripe-webhook] slug reassigned by provision:', slug, '->', pd.company.slug);
    slug = pd.company.slug;
  }
  // Stamp the accepted Merchant Agreement (durable acceptance audit) + the Ann request flag onto
  // settings. Always record terms when the signup carried a version; add the Ann flag if ticked.
  if (meta.terms_version || String(meta.want_ann) === '1') {
    try {
      const rows = await pf.get(`company?id=eq.${encodeURIComponent(companyId)}&select=settings`);
      const s = (rows && rows[0] && rows[0].settings) || {};
      let next = Object.assign({}, s);
      if (meta.terms_version) next.terms = { accepted: true, version: String(meta.terms_version), at: String(meta.terms_at || '') || new Date().toISOString(), via: 'signup' };
      if (String(meta.want_ann) === '1') next.ai = Object.assign({}, s.ai, { phone_requested: true });
      await pf.patch('company', `id=eq.${encodeURIComponent(companyId)}`, { settings: next });
    } catch (_) {}
  }
  // Stamp the subscription so subscription.updated/deleted map back to this company.
  try { await stripe.subscriptions.update(sub.id, { metadata: Object.assign({}, meta, { company_id: companyId }) }); } catch (_) {}

  // AUTO-DELIVER THE FULL TEAM. A self-serve signup only creates the OWNER — the shop owner (Jimmy's
  // report) then had no office/tech logins to hand out. Mint the standard crew (2 office + 4 techs)
  // via shoppack OWNER-MODE so the whole team exists day one: the owner sees + hands them out from
  // their dashboard ("Your team logins"), and they show on the operator /packs. owner_preexisting=1
  // means the owner login (just created above) is recorded, never re-created or reset; its password
  // is carried when we have it. Best-effort — the owner is already fully provisioned + un-stranded,
  // so a failure here NEVER strands them (crew is then recoverable via a shoppack re-run / owner adds
  // manually). Idempotent by slug.
  try {
    const sev = { httpMethod: 'POST', queryStringParameters: { action: 'shoppack', secret: admin },
      body: JSON.stringify({ slug, name: meta.name || slug, trade: meta.trade || 'appliance', office: 2, techs: 4,
        owner_email: email, owner_seat_pw: (pd.login && pd.login.temp_password) || '', owner_preexisting: 1 }) };
    await provision.handler(sev);
  } catch (_) {}

  // Exactly-once gate. The redirect path (platform-signup-verify) AND the webhook both provision,
  // and a non-2xx now makes Stripe RE-DELIVER — so the welcome email has to sit INSIDE this gate,
  // not outside it, or a race/redelivery mails the owner twice. (2026-09-10)
  let already = false;
  try {
    const ex = await pf.get(`event?company_id=eq.${encodeURIComponent(companyId)}&type=eq.platform_signup_provisioned&select=id&limit=1`);
    already = !!(ex && ex.length);
  } catch (_) {}
  if (already) return companyId;

  // DURABLE CREDENTIAL. The redirect path shows the owner their password on the success screen and
  // vaults it on the way past. A customer who closes the tab before Stripe redirects never touches
  // that path, so their only way in was a magic link — and if it expired, or SES dropped it, no
  // password existed anywhere for anyone to hand them. resetpw&once is idempotent: it reveals an
  // already-vaulted password instead of resetting one, so whichever path gets here first wins and
  // the other no-ops. It sits behind the exactly-once gate (so the redirect path, which does far
  // less work, has almost always vaulted first) and after shoppack (so the pack it syncs exists).
  // Residual: two truly simultaneous provisions could both find the vault empty and both reset —
  // the shown password would then be stale, recoverable via the magic link or resetpw&reveal.
  // Best-effort either way; the owner is provisioned regardless. (2026-09-10)
  let pwVaulted = false;
  try {
    const rev = { queryStringParameters: { secret: admin, action: 'resetpw', slug, once: '1' } };
    const rd = JSON.parse((await provision.handler(rev)).body || '{}');
    pwVaulted = !!(rd && rd.ok && rd.saved);
  } catch (_) {}

  // Email the owner a magic login link (best-effort; dry unless EMAIL_ENABLED).
  let link = '', emailed = false, emailMode = 'skipped';
  try {
    const mev = { queryStringParameters: { secret: admin, action: 'magiclink', email, redirect: `${SITE}/platform/owner.html` } };
    const md = JSON.parse((await provision.handler(mev)).body || '{}');
    link = md.login_link || '';
    // criticalSecret for consistency with the rest of the paid chain — an empty read here just
    // downgrades to no_email_shared_secret, which the operator notify now reports loudly.
    const shared = await criticalSecret('EMAIL_SHARED_SECRET');
    if (link && shared) {
      const er = await fetch(`${SITE}/.netlify/functions/send-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': shared },
        body: JSON.stringify({ to: email, subject: 'Your Ant dashboard is ready',
          body: `Welcome to Ant, ${meta.name || slug}!\n\nYour shop is set up and your 14-day trial is running. Tap to sign in:\n${link}\n\nYour team logins (owner + office + techs) are ready on your dashboard under "Your team logins" — hand each person their email + password so they can sign in too.\n\nAny questions, just reply.` }),
        signal: AbortSignal.timeout(9000),
      });
      const ed = await er.json().catch(() => ({}));
      emailMode = ed.mode || (er.ok ? 'sent' : 'error');     // 'live' = really sent · 'dry-run' = EMAIL_ENABLED off
      emailed = !!(er.ok && ed.mode === 'live');
    } else {
      emailMode = link ? 'no_email_shared_secret' : 'no_login_link';
    }
  } catch (_) { emailMode = 'error'; }

  // NEVER-STRAND SAFETY NET: record the provision + the login link + whether the email actually
  // sent, so a paying owner who never got the email is instantly visible + recoverable by the
  // operator (magiclink fallback mints a fresh link on demand). Best-effort — never breaks the paid flow.
  try {
    console.log('[platform-stripe-webhook] provisioned', JSON.stringify({ slug, owner_email: email, emailed, email_mode: emailMode, login_link: link || null }));
    await pf.insert('event', {
      company_id: companyId, type: 'platform_signup_provisioned', entity: slug,
      payload: { slug, owner_email: email, name: meta.name || slug, ref: refCode || null, login_link: link || null, emailed, email_mode: emailMode, password_vaulted: pwVaulted, terms_version: meta.terms_version || null, terms_at: meta.terms_at || null },
    });
    // 🎉 Tell Teddy a shop just started a free trial — text + email (best-effort, never blocks).
    try {
      const notify = require('./_lib/platform-notify');
      const planLabel = meta.plan || 'office';
      const shopName = meta.name || slug;
      // Say whether the login email ACTUALLY went. This notify used to celebrate every signup
      // identically, so a paying owner sitting there with no credentials looked exactly like a
      // clean one. If it didn't send, say so and say how to get them in. (2026-09-10)
      const mailSms = emailed
        ? ' Login link emailed.'
        : ` ⚠️ LOGIN EMAIL DID NOT SEND (${emailMode}) — they have NO way in yet. Get their password from /packs (or resetpw&reveal for ${slug}) and send it.`;
      const mailBody = emailed
        ? `Login link: emailed (${emailMode}).`
        : `⚠️ LOGIN EMAIL DID NOT SEND (${emailMode}). This owner has paid and has a shop, but nothing has reached them — they cannot sign in until you send credentials.\nTheir password is vaulted${pwVaulted ? '' : ' (vaulting reported a problem — check it)'}: ${SITE}/.netlify/functions/platform-provision?action=resetpw&secret=<admin>&slug=${slug}&reveal=1&once=1\nOr open ${SITE}/packs and read the owner row.`;
      await notify.notifyOperator({
        tag: 'platform_signup',
        sms: `🎉 New AssistAnt signup: ${shopName} (${email}) — ${planLabel} plan, 14-day trial started.${refCode ? ' ref:' + refCode : ''}${mailSms}`,
        subject: `${emailed ? 'New AssistAnt signup' : '⚠️ New AssistAnt signup — LOGIN NOT DELIVERED'} — ${shopName}`,
        email_body: `A new shop just started a free trial.\n\nShop: ${shopName}\nEmail: ${email}\nPlan: ${planLabel}\nSlug: ${slug}${refCode ? '\nReferral: ' + refCode : ''}\nStarted: ${new Date().toISOString()}\n\n${mailBody}\n\nOperator dashboard: ${SITE}/platform-dashboard\nAll shops: ${SITE}/shops`,
      });
    } catch (_) {}
    // 📈 AD FEEDBACK — teach ChatGPT/OpenAI Ads that a SaaS signup CONVERTED, so the /guide
    // ad optimizes on real signups instead of blind clicks (ranking = bid × relevance × trust ×
    // conversion-likelihood — this feeds the last term). Matches on the owner's hashed phone/email
    // (which we have here). DARK/no-op until OPENAI_ADS_CONVERSION_KEY + OPENAI_ADS_PIXEL_ID are
    // vaulted (the uploader returns not_configured), and fully try/caught so it NEVER breaks the
    // paid provision. Fires exactly once (inside the deduped block). event_id dedups on OpenAI's side.
    // NOTE (documented follow-ons, NOT wired here): Google offline conversion needs a gclid carried
    // /guide→signup; Meta needs a server-side CAPI uploader (none exists yet) — the Meta Pixel already
    // fires a client-side Lead on signup.html. This is the one channel we can feed cleanly today.
    try {
      const { uploadOpenAiConversion } = require('./openai-ads-upload-conversion');
      await uploadOpenAiConversion({
        event_type: 'lead_created',
        phone: meta.owner_phone || '', email,
        value: 99, when_ms: Date.now(),
        source_url: `${SITE}/guide`,
        event_id: 'saas-signup-' + slug,
      });
    } catch (_) {}
  } catch (_) {}
  return companyId;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // criticalSecret: the webhook is the backstop that provisions a PAID shop when the
  // redirect path flakes. An empty read here 500s -> Stripe re-delivers, but if the
  // redirect ALSO flaked the shop is delayed. Read both bulletproof so the backstop holds.
  const whSecret = await criticalSecret('PLATFORM_STRIPE_WEBHOOK_SECRET');
  // Prefer the dedicated platform key; fall back to STRIPE_SECRET_KEY so this MATCHES what
  // checkout signs with (platform-billing.js does the same || fallback). Without the fallback a
  // deploy carrying only STRIPE_SECRET_KEY takes every payment and 500s every webhook — the shop
  // then depends entirely on the redirect path, and the stranded-signup alert never fires because
  // the webhook dies before reaching it. (2026-09-10)
  const key = (await criticalSecret('PLATFORM_STRIPE_SECRET_KEY')) || (await criticalSecret('STRIPE_SECRET_KEY')) || '';
  if (!whSecret || !key) {
    console.error('[platform-stripe-webhook] missing PLATFORM_STRIPE_WEBHOOK_SECRET or stripe key');
    return { statusCode: 500, body: JSON.stringify({ error: 'not configured' }) };
  }

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');

  let ev;
  try {
    ev = Stripe.webhooks.constructEvent(rawBody, sig, whSecret);
  } catch (err) {
    console.error('[platform-stripe-webhook] bad signature:', err.message);
    return { statusCode: 400, body: JSON.stringify({ error: 'bad signature' }) };
  }

  const handled = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.created', 'customer.subscription.deleted'];
  if (handled.indexOf(ev.type) === -1) {
    return { statusCode: 200, body: JSON.stringify({ ignored: true, type: ev.type }) };
  }

  try {
    const pf = await platform();
    if (!pf) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'platform_not_configured' }) };
    const stripe = new Stripe(key);
    const priceMap = await catalogPriceMap();

    let sub = null, session = null;
    if (ev.type === 'checkout.session.completed') {
      session = ev.data.object;
      if (session.mode !== 'subscription' || !session.subscription) {
        return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: 'not_subscription_checkout' }) };
      }
      sub = await stripe.subscriptions.retrieve(session.subscription);
    } else {
      sub = ev.data.object; // subscription.* events carry the subscription
    }

    let companyId = await findCompanyId(pf, sub, session);

    // PROVISION-ON-PAYMENT: a self-serve signup checkout completed and no tenant exists yet.
    // Stand up the shop now (card has cleared), then map the subscription to it.
    const meta = (sub && sub.metadata) || (session && session.metadata) || {};
    if (!companyId && ev.type === 'checkout.session.completed' && String(meta.company_provision) === '1') {
      companyId = await provisionFromMeta(pf, stripe, sub, meta);
    }

    if (!companyId) {
      console.error('[platform-stripe-webhook] no company match for', ev.type, sub && sub.id);
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no_company_match' }) };
    }

    const canceled = ev.type === 'customer.subscription.deleted' || sub.status === 'canceled';
    const ent = await resolveEntitlement(sub, priceMap);
    const compStatus = canceled ? 'churned' : subStatusToCompanyStatus(sub.status);
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

    const patch = {
      stripe_customer_id: sub.customer || undefined,
      stripe_subscription_id: sub.id || undefined,
      billing_status: sub.status || undefined,
      status: compStatus,
      current_period_end: periodEnd || undefined,
      trial_ends_at: trialEnd || undefined,
    };
    if (canceled) {
      // Keep the row + history; strip entitlements, mark churn. Do NOT delete data.
      patch.features = {};
      patch.churned_at = new Date().toISOString();
      patch.churn_reason = 'subscription_canceled';
      // Release the phone number + delete Ann so a churned shop stops costing us the ~$1/mo.
      try {
        const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
        await require('./platform-phone').handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'release', secret: admin, company_id: companyId }) });
      } catch (_) {}
    } else if (ent.planKey) {
      patch.plan = ent.planKey;
      patch.features = plans.featuresFor(ent.planKey, ent.addons);
    }

    const row = await applyEntitlement(companyId, patch);

    // Ant Army pay-on-collection: if THIS shop was referred, recompute its referrer's $25/mo bill
    // credit — the moment a referred shop goes active (or churns) the referrer's credit changes.
    // Best-effort + dark until PLATFORM_REFERRAL_CREDIT_LIVE=1; never blocks or fails the webhook.
    try {
      const rr = await pf.get(`company?id=eq.${encodeURIComponent(companyId)}&select=referred_by`);
      const refCode = rr && rr[0] && rr[0].referred_by;
      if (refCode) { await require('./platform-referral').applyReferrerByCode(String(refCode)); }
    } catch (_) {}

    console.log('[platform-stripe-webhook]', ev.type, companyId, JSON.stringify({ plan: patch.plan, status: patch.status, canceled }));
    return { statusCode: 200, body: JSON.stringify({ ok: true, company_id: companyId, applied: !!row, plan: patch.plan || null, status: patch.status }) };
  } catch (e) {
    console.error('[platform-stripe-webhook] error:', e.message);
    // A PAID signup whose provision failed is the one case worth burning Stripe's retry budget on:
    // answer non-2xx so Stripe re-delivers and the shop stands itself up on the next attempt.
    // Everything else stays 200 — a subscription.* drift is not worth hammering retries (and a
    // deterministic bug answering non-2xx forever would get the endpoint disabled by Stripe).
    if (e && e.retryable) {
      return { statusCode: 503, body: JSON.stringify({ ok: false, error: e.message, retry: true }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

// Reused by platform-signup-verify (provision-on-redirect) so the tenant is stood up even when
// the webhook signing secret isn't configured — one source of truth, no drift.
module.exports.provisionFromMeta = provisionFromMeta;
module.exports.findCompanyId = findCompanyId;
