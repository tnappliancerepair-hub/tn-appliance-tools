// platform-usage-bill — the weekly Stripe metered biller for Ann. Once a week it reads each
// tenant's LAST completed Mon–Sun week straight from Telnyx (by number + assistant), computes
// the overage above the included 400 min + 100 texts ($0.40/min, $0.05/text), and reports as Stripe usage records
// against the tenant's Ann metered subscription items. The flat $50 base rides Stripe's own
// weekly cycle; this only reports the OVERAGE (usage_type:'metered' items). Billing is exact
// per shop because each tenant = one number + one assistant (usage-meter.weeklyTelnyx).
//
//   GET/POST ?secret=<admin>[&company_id=<id>][&dry=1]
//     -> { ok, live, week, tenants:[ {slug, minutes, texts, over_min, over_text, billed|would_bill} ] }
//
// SHADOW by default: with PLATFORM_BILLING_LIVE != 'true' (or ?dry=1) it computes + returns what
// it WOULD report and charges NOTHING. Flip PLATFORM_BILLING_LIVE=true to actually post usage
// records. Also no-ops safely when Stripe isn't configured (returns the shadow report).
'use strict';

const Stripe = require('stripe');
const plans = require('../../platform/plans.js');
const meter = require('./_lib/usage-meter');
const billing = require('./platform-billing');
const { getSecret } = require('./_lib/secrets');
const { platform } = require('./_lib/platform-rest');

function J(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

exports.config = { timeout: 60 };

// Anchor a week BEHIND now so we bill the just-completed Mon–Sun (this fn runs Monday).
function lastWeekAnchor() { return Date.now() - 7 * 86400000; }

// Post a usage record to a metered subscription item for the billed week. action:'set' makes it
// idempotent — re-running the same week overwrites rather than doubles. Timestamped to the week's
// end so it lands in the right invoice period.
async function postUsage(stripe, itemId, qty, tsUnix) {
  return stripe.subscriptionItems.createUsageRecord(itemId, { quantity: Math.max(0, Math.round(qty)), timestamp: tsUnix, action: 'set' });
}

async function billTenant(pf, stripe, live, company, anchorMs) {
  const A = plans.ANN;
  const phone = (company.settings && company.settings.phone) || {};
  const out = { slug: company.slug || company.id, company_id: company.id };
  if (!phone.number) { out.skip = 'no_phone'; return out; }

  let w;
  try { w = await meter.weeklyTelnyx(phone.number, phone.assistant_id, anchorMs); }
  catch (_) { out.skip = 'meter_err'; return out; }
  out.week = w.week_label;
  out.minutes = w.minutes; out.texts = w.texts;
  out.over_min = Math.max(0, w.minutes - A.included_min);
  out.over_text = Math.max(0, w.texts - A.included_texts);
  const weekEndUnix = Math.floor((meter.weekBoundsCT(anchorMs).endMs - 1) / 1000);

  // Nothing over the buckets → nothing to report (base rides Stripe's own cycle).
  if (out.over_min === 0 && out.over_text === 0) { out.result = 'within_allowance'; return out; }

  if (!live) { out.result = 'would_bill'; out.would = { min: out.over_min, text: out.over_text }; return out; }
  if (!stripe) { out.result = 'stripe_not_configured'; return out; }
  if (!company.stripe_customer_id) { out.result = 'no_stripe_customer'; return out; }

  const ann = await billing.ensureAnnSubscription(pf, stripe, company);
  if (ann.error) { out.result = 'ann_sub_' + ann.error; return out; }
  try {
    if (out.over_min > 0 && ann.item_min) await postUsage(stripe, ann.item_min, out.over_min, weekEndUnix);
    if (out.over_text > 0 && ann.item_text) await postUsage(stripe, ann.item_text, out.over_text, weekEndUnix);
    out.result = 'billed'; out.billed = { min: out.over_min, text: out.over_text };
  } catch (e) { out.result = 'stripe_err'; out.error = String(e && e.message || e).slice(0, 160); }
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let b = {}; try { b = event.body ? JSON.parse(event.body) : {}; } catch (_) {}
  const scheduled = !!(b && b.next_run); // cron wrapper self-auth

  const secret = b.secret || q.secret || '';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && secret !== admin) return J(401, { ok: false, error: 'unauthorized' });

  const pf = await platform();
  if (!pf) return J(200, { ok: false, error: 'platform_not_configured' });

  const live = String((await getSecret('PLATFORM_BILLING_LIVE')) || '').toLowerCase() === 'true'
    && !(q.dry === '1' || b.dry === 1 || b.dry === '1');

  let stripe = null;
  try { const key = await billing.stripeKey(); if (key) stripe = new Stripe(key); } catch (_) {}

  const one = b.company_id || q.company_id || '';
  const filter = one ? `id=eq.${encodeURIComponent(one)}` : `status=in.(active,trial)`;
  const rows = await pf.get(`company?${filter}&select=id,name,slug,status,settings,stripe_customer_id,stripe_subscription_id`);
  const anchorMs = lastWeekAnchor();
  const wk = meter.weekBoundsCT(anchorMs).label;

  const tenants = [];
  for (const c of (rows || [])) {
    if (!(c.settings && c.settings.phone && c.settings.phone.number)) continue;
    tenants.push(await billTenant(pf, stripe, live, c, anchorMs));
  }

  const billed = tenants.filter((t) => t.result === 'billed').length;
  const wouldBill = tenants.filter((t) => t.result === 'would_bill').length;
  return J(200, { ok: true, live, stripe_configured: !!stripe, week: wk, count: tenants.length, billed, would_bill: wouldBill, tenants });
};
