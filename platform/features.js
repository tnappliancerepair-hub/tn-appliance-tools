/* features.js — the ONE client helper for reading company.features on the platform surfaces.
   Mirrors netlify/functions/_lib/platform-features.js so browser + server agree. The webhook
   (platform-stripe-webhook) writes company.features from the shop's plan + add-ons; every surface
   gates on it through here.

   DEFAULT-OPEN when the map is empty: an unpopulated / pre-entitlement / demo / grandfathered
   tenant (features = {} or null) shows everything, so gating can never break a live shop's view.
   Only a POPULATED map gates — then a missing key hides that feature exactly. (Cancel-time access
   is handled at the status/billing layer, not by hiding sections here.) */
(function (root) {
  'use strict';
  function isEmpty(f) { return !f || typeof f !== 'object' || Object.keys(f).length === 0; }
  function has(features, key) { if (isEmpty(features)) return true; return !!features[key]; }
  function hasAny(features, keys) { return (keys || []).some(function (k) { return has(features, k); }); }
  function hasAll(features, keys) { return (keys || []).every(function (k) { return has(features, k); }); }
  var api = { has: has, hasAny: hasAny, hasAll: hasAll, isEmpty: isEmpty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PlatformFeatures = api;
})(typeof window !== 'undefined' ? window : null);
