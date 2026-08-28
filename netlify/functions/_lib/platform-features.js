// platform-features — the ONE place that decides what a shop's plan includes. A paid
// subscription (via platform-stripe-webhook) writes company.features here; every surface
// gates on it. computeFeatures() maps a base plan + add-ons -> the jsonb bool map, using the
// same plans.js catalog the signup page and billing use, so nothing drifts.
'use strict';

const plans = require('../../../platform/plans.js');
const { platform } = require('./platform-rest');

// Union features for a base plan + selected add-on keys (delegates to the shared catalog).
function computeFeatures(planKey, addonKeys) {
  return plans.featuresFor(planKey, addonKeys || []);
}

function has(features, key) {
  return !!(features && features[key]);
}

// Read a company's live feature map (server-side; {} if unknown / not configured).
async function companyFeatures(companyId) {
  const pf = await platform();
  if (!pf || !companyId) return {};
  const rows = await pf.get(`company?id=eq.${encodeURIComponent(companyId)}&select=features`);
  return (rows && rows[0] && rows[0].features) || {};
}

// Apply an entitlement change to a company: flip plan/status/features + Stripe linkage in one
// patch. Called by the webhook when a subscription is created/updated/canceled. All fields
// optional — pass only what changed. Returns the updated row (or null if not configured).
async function applyEntitlement(companyId, opts) {
  const pf = await platform();
  if (!pf || !companyId) return null;
  const o = opts || {};
  const patch = {};
  if (o.plan != null) patch.plan = o.plan;
  if (o.status != null) patch.status = o.status;
  if (o.features != null) patch.features = o.features;
  else if (o.planKey != null) patch.features = computeFeatures(o.planKey, o.addons);
  if (o.stripe_customer_id != null) patch.stripe_customer_id = o.stripe_customer_id;
  if (o.stripe_subscription_id != null) patch.stripe_subscription_id = o.stripe_subscription_id;
  if (o.billing_status != null) patch.billing_status = o.billing_status;
  if (o.trial_ends_at != null) patch.trial_ends_at = o.trial_ends_at;
  if (o.current_period_end != null) patch.current_period_end = o.current_period_end;
  if (o.billing_email != null) patch.billing_email = o.billing_email;
  if (o.churned_at != null) patch.churned_at = o.churned_at;
  if (o.churn_reason != null) patch.churn_reason = o.churn_reason;
  if (!Object.keys(patch).length) return null;
  patch.updated_at = new Date().toISOString();
  const rows = await pf.patch('company', `id=eq.${encodeURIComponent(companyId)}`, patch);
  return rows[0] || null;
}

module.exports = { computeFeatures, has, companyFeatures, applyEntitlement };
