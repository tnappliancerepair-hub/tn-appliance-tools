/* plans.js — the ONE plan/module catalog for the Ant platform. This is the à-la-carte
   builder as data: shops pick a base tier + optional add-ons; each carries the `features`
   it unlocks (the same jsonb bool map the surfaces already gate on) and a Stripe Price ID
   pulled from config (empty until created in Stripe). Loads in the browser (window.PlatformPlans)
   and in Node (module.exports) so signup, billing, and the webhook all read the same source.

   PRICES ARE PLACEHOLDERS — the owner sets the real numbers before go-live. Nothing here
   charges anyone; the price shown is display-only. The Stripe Price ID (set at flip-to-live)
   is what actually bills. */
(function (root) {
  'use strict';

  // The software base — the monthly Full Office Platform (the shop runs its whole back office on
  // it). Ann (the phone) is a SEPARATE weekly metered product, see ANN below — the hybrid model
  // (Teddy 2026-08-28): monthly software + Ann phone add-on. `phones` is NOT here — that entitlement
  // comes from the Ann add-on. Price is a PLACEHOLDER the owner sets.
  var PLANS = [
    {
      key: 'office',
      label: 'Full Office Platform',
      blurb: 'The job board, scheduling, customer portal, invoicing, and the tech pay spine — one system your whole shop runs on.',
      price_cents: 9900,                 // $99/mo — LOCKED 2026-08-28 (flat per shop; undercuts HCP/Workiz, near Jobber)
      price_env: 'STRIPE_PRICE_OFFICE',
      features: { database: true, scheduling: true, portal: true, invoicing: true, pay: true, usage_digest: true }
    }
  ];

  // Add-ons — a shop can stack any of these on top of its base tier.
  var ADDONS = [
    {
      key: 'own_area',
      label: 'Own Your Area',
      blurb: "We won't sign another shop in your territory. Exclusive rights to your service area.",
      price_cents: 19900,                // $199/mo — LOCKED 2026-08-28
      price_env: 'STRIPE_PRICE_OWN_AREA',
      features: { exclusive_territory: true }
    },
    {
      key: 'local_seo',
      label: 'Local SEO / Connect Google',
      blurb: 'Ant runs your Google Business Profile — auto-posts, review replies, screened job photos, Q&A.',
      price_cents: 14900,                // $149/mo — LOCKED 2026-08-28
      price_env: 'STRIPE_PRICE_LOCAL_SEO',
      features: { local_seo: true }
    }
  ];

  // Union the features across a base plan + selected add-ons → the jsonb map company.features holds.
  function featuresFor(planKey, addonKeys) {
    var out = {};
    var p = PLANS.filter(function (x) { return x.key === planKey; })[0];
    if (p) Object.keys(p.features).forEach(function (k) { out[k] = true; });
    (addonKeys || []).forEach(function (ak) {
      var a = ADDONS.filter(function (x) { return x.key === ak; })[0];
      if (a) Object.keys(a.features).forEach(function (k) { out[k] = true; });
    });
    return out;
  }

  function byKey(key) {
    return PLANS.filter(function (x) { return x.key === key; })[0] ||
           ADDONS.filter(function (x) { return x.key === key; })[0] || null;
  }

  // The Ann phone plan — metered (separate from the flat software tiers above). $50/week base
  // includes 400 minutes + 100 texts (Teddy 2026-08-28). Overage: $0.40/min, $0.05/text — both
  // above our real cost (~$0.084/min, ~$0.045/multi-part-text). Billed by reporting each completed
  // week's overage as Stripe usage records (platform-usage-bill). Stripe setup: create 3 recurring
  // WEEKLY prices — a flat base + two metered (usage_type 'metered') for minute + text overage —
  // and vault under the price_env keys.
  var ANN = {
    key: 'ann_phone', label: 'Ann — AI Receptionist',
    blurb: 'Ann answers 24/7, captures every lead, and texts you the job. Your phone never goes to voicemail again.',
    features: { phones: true },
    base_cents: 5000, period: 'week', included_min: 400, included_texts: 100,
    overage_min_cents: 40, overage_text_cents: 5,
    price_env_base: 'STRIPE_PRICE_ANN_BASE',
    price_env_min_overage: 'STRIPE_PRICE_ANN_MIN_OVERAGE',
    price_env_text_overage: 'STRIPE_PRICE_ANN_TEXT_OVERAGE',
  };

  var api = { PLANS: PLANS, ADDONS: ADDONS, ANN: ANN, featuresFor: featuresFor, byKey: byKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PlatformPlans = api;
})(typeof window !== 'undefined' ? window : null);
