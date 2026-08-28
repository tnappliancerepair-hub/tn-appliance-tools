/* verticals.js — the vertical FACTORY catalog. One row per "[Trade] Ant" front door.
   This is the single source the branded landing (vertical.html), the signup page, and the
   provisioning flow all read, so a new vertical is a CONFIG (a row here + a domain), never a
   fork. Every vertical rides the SAME platform + brain + billing — only the face changes.

   `trade` MUST match a trade_profile key the platform knows (appliance | automotive | aquarium
   | furniture | dealership | …) — that's what makes signup provision the right workflow/vocab.

   Loads in the browser (window.PlatformVerticals) and Node (module.exports).

   ➕ To stand up a new vertical: add a row here → deploy → point the domain at this Netlify
   site (DNS). Signup + phone AI + database work for it the same day (all trade-agnostic).
   The trade's KNOWLEDGE brain starts empty and deepens as that vertical's shops feed it. */
(function (root) {
  'use strict';

  // The umbrella — the master brand + generic fallback when a host isn't a known vertical.
  var UMBRELLA = {
    key: 'ant', brand: 'AssistAnt 24/7', trade: 'appliance', domains: [],
    tagline: 'The AI that runs your trade.',
    hero: 'Answer every call, book every job, get every tech paid — one system your whole shop runs on.',
    proof: ['24/7 AI phone answering', 'Job board + scheduling', 'Customer portal', 'Tech pay + invoicing'],
    accent: '#3f8f24', emoji: '🐜',
  };

  // The verticals. `live:true` = has a real flagship shop pulling on it today.
  var VERTICALS = [
    {
      key: 'appliance', brand: 'AssistAnt 24/7', trade: 'appliance', live: true,
      domains: ['applianceant.com', 'www.applianceant.com'],
      tagline: 'The AI that runs your appliance repair shop.',
      hero: 'Answer every call, book every job, file every warranty claim — one system your whole shop runs on.',
      proof: ['24/7 AI phone answering', 'Job board + scheduling', 'Warranty filing (AHS/ServicePower/…)', 'Parts prediction + tech pay'],
      accent: '#3f8f24', emoji: '🔧',
    },
    {
      key: 'auto-repair', brand: 'AssistAnt 24/7', trade: 'automotive', live: false,
      domains: ['autorepairant.com', 'www.autorepairant.com'],
      tagline: 'The AI that runs your auto repair shop.',
      hero: 'Answer every call, book every job, keep every bay full — one system your whole shop runs on.',
      proof: ['24/7 AI phone answering', 'Job board + scheduling', 'Customer portal + comms', 'Tech pay + invoicing'],
      accent: '#c0392b', emoji: '🔩',
    },
    {
      key: 'aquarium', brand: 'AssistAnt 24/7', trade: 'aquarium', live: false,
      domains: ['aquariumant.com', 'www.aquariumant.com'],
      tagline: 'The AI that runs your aquarium service business.',
      hero: 'Answer every call, book every maintenance visit, keep every tank on schedule — one system.',
      proof: ['24/7 AI phone answering', 'Recurring service scheduling', 'Customer portal + comms', 'Tech pay + invoicing'],
      accent: '#1b6ca8', emoji: '🐠',
    },
    {
      key: 'furniture', brand: 'AssistAnt 24/7', trade: 'furniture', live: false,
      domains: ['furnitureant.com', 'www.furnitureant.com'],
      tagline: 'The AI that runs your furniture delivery + service business.',
      hero: 'Answer every call, track every order + delivery, keep every customer in the loop — one system.',
      proof: ['24/7 AI phone answering', 'Order + delivery pipeline', 'Customer portal + comms', 'Invoicing + pay'],
      accent: '#8a5a2b', emoji: '🛋️',
    },
    {
      key: 'dealership', brand: 'AssistAnt 24/7', trade: 'dealership', live: false,
      domains: ['dealerant.com', 'www.dealerant.com'],
      tagline: 'The AI that runs your dealership sales floor.',
      hero: 'Answer every call, work every lead, move every unit — one system your whole lot runs on.',
      proof: ['24/7 AI phone answering', 'Lead → test-drive → sold pipeline', 'Customer portal + comms', 'Deal tracking'],
      accent: '#4b3f8f', emoji: '🚗',
    },
  ];

  function norm(h) { return String(h || '').toLowerCase().trim().replace(/:\d+$/, ''); }

  // Resolve the vertical for a hostname (the whole "one Netlify, many domains" trick).
  function byHostname(host) {
    var h = norm(host);
    for (var i = 0; i < VERTICALS.length; i++) {
      if (VERTICALS[i].domains.some(function (d) { return d === h; })) return VERTICALS[i];
    }
    // dev/preview hosts (netlify.app, localhost, tnapplianceexchange.net) → umbrella
    return UMBRELLA;
  }
  function byKey(key) {
    var k = String(key || '').toLowerCase();
    if (k === 'ant') return UMBRELLA;
    return VERTICALS.filter(function (v) { return v.key === k; })[0] || null;
  }
  // Pick by explicit ?v= override first, else hostname.
  function resolve(host, vParam) {
    if (vParam) { var v = byKey(vParam); if (v) return v; }
    return byHostname(host);
  }

  var api = { UMBRELLA: UMBRELLA, VERTICALS: VERTICALS, byHostname: byHostname, byKey: byKey, resolve: resolve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PlatformVerticals = api;
})(typeof window !== 'undefined' ? window : null);
