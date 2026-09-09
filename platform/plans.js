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
      blurb: 'The job board, scheduling, customer portal, invoicing, and the tech pay spine — plus a website we build you, Google + reviews on autopilot. One system your whole shop runs on.',
      price_cents: 9900,                 // $99/mo — LOCKED 2026-08-28 (flat per shop; undercuts HCP/Workiz, near Jobber)
      price_env: 'STRIPE_PRICE_OFFICE',
      // Website + Connect-Google + reviews are INCLUDED (Teddy 2026-08-28 — matches Jobber's free,
      // the switch hook), no longer a separate paid add-on.
      features: { database: true, scheduling: true, portal: true, invoicing: true, pay: true, usage_digest: true, website: true, local_seo: true, reviews: true }
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
    }
    // NOTE: 'Local SEO / Connect Google' is no longer a paid add-on — website + Google + reviews
    // are INCLUDED in Full Office (Teddy 2026-08-28). Kept out of ADDONS so it never bills separately.
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

  // The Ann phone plans — metered (separate from the flat software tiers above). TWO tiers, both
  // priced at the SAME 12.5c per included minute, so stepping up buys headroom, not a better rate:
  //   ann_phone (Starter)  $50/wk =  400 min + 250 texts   overage $0.40/min, $0.05/text
  //   ann_pro   (Pro)     $125/wk = 1000 min + 800 texts   overage $0.25/min, $0.05/text
  // Crossover: a shop steadily over ~588 min/wk pays less on Pro than on Starter + overage, and
  // OUR margin at that crossover is identical either way — so moving a busy shop up costs nothing.
  //
  // Included TEXTS sized off real platform behaviour: ~5 texts per job (confirm, day-before,
  // on-my-way, complete, review ask), so 250 ~= 50 jobs/wk. 100 was too low — it put almost every
  // shop into overage on week one for texts OUR automation sent, which is both a bad surprise and
  // an incentive to switch the automation off (Teddy 2026-09-08).
  //
  // Cost basis (MEASURED 2026-09-08, see usage-meter COST): $0.068/min all-in (voice engine
  // $0.050 + LLM inference $0.018), $0.013/text out, $0.0075/text in, plus ~$3.50/wk fixed per
  // shop (DID + 10DLC) — that fixed line is an ESTIMATE pending a real Telnyx invoice.
  // Worst case with BOTH allowances maxed is ~29% margin on Starter, ~33% on Pro; typical 45-60%.
  //
  // Stripe setup per tier: a flat weekly base price + two metered prices (usage_type 'metered')
  // for minute + text overage. `platform-billing?action=setup_ann[&tier=ann_pro]` creates them.
  var ANN = {
    key: 'ann_phone', label: 'Ann — AI Receptionist',
    blurb: 'Ann answers 24/7, captures every lead, and texts you the job. Your phone never goes to voicemail again.',
    features: { phones: true },
    base_cents: 5000, period: 'week', included_min: 400, included_texts: 250,
    overage_min_cents: 40, overage_text_cents: 5,
    lookup_base: 'ann_base_wk', lookup_min: 'ann_min_overage_wk', lookup_text: 'ann_text_overage_wk',
    price_env_base: 'STRIPE_PRICE_ANN_BASE',
    price_env_min_overage: 'STRIPE_PRICE_ANN_MIN_OVERAGE',
    price_env_text_overage: 'STRIPE_PRICE_ANN_TEXT_OVERAGE',
  };

  var ANN_PRO = {
    key: 'ann_pro', label: 'Ann Pro — AI Receptionist',
    blurb: 'For a busy shop. Everything in Ann, with room for about 450 calls a week before overage.',
    features: { phones: true },
    base_cents: 12500, period: 'week', included_min: 1000, included_texts: 800,
    overage_min_cents: 25, overage_text_cents: 5,
    lookup_base: 'ann_pro_base_wk', lookup_min: 'ann_pro_min_overage_wk', lookup_text: 'ann_pro_text_overage_wk',
    price_env_base: 'STRIPE_PRICE_ANN_PRO_BASE',
    price_env_min_overage: 'STRIPE_PRICE_ANN_PRO_MIN_OVERAGE',
    price_env_text_overage: 'STRIPE_PRICE_ANN_PRO_TEXT_OVERAGE',
  };

  var ANN_TIERS = [ANN, ANN_PRO];

  // Resolve a tier by key. Unknown/absent -> Starter, so every existing tenant is unchanged.
  function annTier(key) {
    for (var i = 0; i < ANN_TIERS.length; i++) { if (ANN_TIERS[i].key === key) return ANN_TIERS[i]; }
    return ANN;
  }

  // A company's Ann tier lives at settings.phone.ann_tier. Absent -> Starter.
  function annTierFor(company) {
    var ph = (company && company.settings && company.settings.phone) || {};
    return annTier(ph.ann_tier);
  }

  var api = { PLANS: PLANS, ADDONS: ADDONS, ANN: ANN, ANN_PRO: ANN_PRO, ANN_TIERS: ANN_TIERS,
              annTier: annTier, annTierFor: annTierFor, featuresFor: featuresFor, byKey: byKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PlatformPlans = api;
})(typeof window !== 'undefined' ? window : null);
