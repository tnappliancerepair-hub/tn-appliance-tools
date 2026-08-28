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

  const hasOver = out.over_min > 0 || out.over_text > 0;

  // SHADOW — show what we'd do; charge nothing.
  if (!live) {
    out.result = hasOver ? 'would_bill' : 'within_allowance';
    if (hasOver) out.would = { min: out.over_min, text: out.over_text };
    return out;
  }
  if (!stripe) { out.result = 'stripe_not_configured'; return out; }
  if (!company.stripe_customer_id) { out.result = 'no_stripe_customer'; return out; }

  // Ensure the Ann subscription EXISTS for every phone tenant (idempotent — no Stripe call after
  // the first time). This is what makes the flat $50/week base bill on Stripe's own weekly cycle
  // EVEN in weeks with no overage — so a shop that stays under 400 min / 100 texts still pays $50,
  // never gets Ann free. The biller then only ADDS the overage on top.
  const ann = await billing.ensureAnnSubscription(pf, stripe, company);
  if (ann.error) { out.result = 'ann_sub_' + ann.error; return out; }
  if (!hasOver) { out.result = 'base_only'; return out; } // sub carries the $50 base; nothing extra to report

  const cust = company.stripe_customer_id;
  const idBase = `${company.id}-${w.week_start}`;
  try {
    // Report overage as METER EVENTS (customer-scoped). identifier dedups a same-week re-run.
    if (out.over_min > 0) await billing.reportAnnUsage(stripe, billing.ANN_MIN_EVENT, cust, out.over_min, idBase + '-min', weekEndUnix);
    if (out.over_text > 0) await billing.reportAnnUsage(stripe, billing.ANN_TEXT_EVENT, cust, out.over_text, idBase + '-text', weekEndUnix);
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
