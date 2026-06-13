// Ant add-on services catalog — low-risk, high-margin extras the tech can offer
// while they're already at the appliance. Each add-on has the customer pitch
// (insurance / safety framing), a price, and the tech's cut (extra money for
// simple work). Prices/cuts are easy to tune here — set them to your numbers.
//
// Loaded as: <script src="/ant-addons.js"></script>  -> window.AntAddons
//
// window.AntAddons.forAppliance('washer') -> [{key,name,price,tech_cut,pitch,recommend}]
(function (root) {
  'use strict';

  // Customer-portal add-on offers: "$10 off, shipped/installed with your repair."
  // PRICING RULE (Teddy 2026-06-13): customer price = part cost + 30% (shop) +
  //   tech cut, where tech cut = 50% but never below $20. `price` is the "was"
  //   sticker; net = price - discount is what the customer pays. Net is built to
  //   satisfy the rule against real part costs (from Amazon, June 2026).
  var DISCOUNT = 10; // $ off when added through the portal
  var CATALOG = {
    washer: [
      { key: 'washer_supply_lines', name: 'New washer supply lines (installed)', price: 50, tech_cut: 20, discount: 10, // part ~$15 -> net $40: shop $20 (cost+30%), tech $20
        pitch: "Burst or leaking washer hoses are a top cause of home water damage, and most makers recommend replacing them about every 5 years. We'll install a fresh set while we're there." },
      { key: 'washer_leak_detector', name: 'Smart water leak detector (placed)', price: 49, tech_cut: 20, discount: 10, // smart sensor ~$12 -> net $39: shop $19, tech $20
        pitch: "A smart sensor sits behind your washer and alerts your phone the second it senses water — leaking valves and hoses cause some of the priciest damage we see. Cheap insurance." },
    ],
    dryer: [
      { key: 'dryer_cleanout', name: 'Dryer clean-out', price: 80, tech_cut: 35, discount: 10, // service, no part -> net $70: 50% split, tech $35
        pitch: "Lint build-up is the #1 dryer fire risk and makes everything take longer to dry. We'll do a full clean-out while we're there — quick and worth it." },
      { key: 'dryer_vent_hose', name: 'New dryer vent hose (installed)', price: 45, tech_cut: 20, discount: 10, // basic foil hose ~$9 -> net $35: shop $15, tech $20
        pitch: "A fresh vent hose means better airflow and a safer dryer — installed while we're there." },
      { key: 'dryer_vent_magnetic', name: 'Magnetic quick-connect vent kit (installed)', price: 79, tech_cut: 20, discount: 10, // kit ~$35 -> net $69: shop $49 (cost+30%), tech $20
        pitch: "Upgrade to an airtight magnetic quick-connect — best airflow and seal, and makes pulling the dryer out a snap next time. Installed while we're there." },
    ],
    refrigerator: [
      { key: 'fridge_coil_clean', name: 'Condenser coil vac + blow-out', price: 80, tech_cut: 35, discount: 10, // service, no part -> net $70: 50% split, tech $35
        pitch: "Dirty condenser coils shorten your fridge's life and raise your energy bill. We'll vac + blow them out while we're there — recommended every 6-12 months." },
      { key: 'fridge_supply_line', name: 'New fridge water/ice line (installed)', price: 49, tech_cut: 20, discount: 10, // braided line ~$13 -> net $39: shop $19, tech $20
        pitch: "The water line behind the fridge is a common hidden leak source — cheap protection against a slow leak under your floor." },
      { key: 'fridge_water_filter', name: 'Fresh water filter (installed)', price: 69, tech_cut: 20, discount: 10, // OEM filter ~$30 (brand-varies) -> net $59: shop $39, tech $20
        pitch: "Clean water and ice — manufacturers recommend a new filter about every 6 months. We'll drop one in while we're there." },
      { key: 'fridge_leak_detector', name: 'Smart water leak detector (placed)', price: 49, tech_cut: 20, discount: 10, // smart sensor ~$12 -> net $39: shop $19, tech $20
        pitch: "A smart sensor under your fridge catches an ice-maker or water-line leak before it ruins your floor — and texts your phone, not just beeps in an empty kitchen." },
    ],
    dishwasher: [
      { key: 'dishwasher_supply_line', name: 'New dishwasher fill line (installed)', price: 49, tech_cut: 20, discount: 10, // braided line ~$13 -> net $39: shop $19, tech $20
        pitch: "The dishwasher fill line runs under your cabinet where a slow leak goes unseen for months. A fresh braided line while we're there is cheap protection." },
      { key: 'dishwasher_leak_detector', name: 'Smart water leak detector (placed)', price: 49, tech_cut: 20, discount: 10, // smart sensor ~$12 -> net $39: shop $19, tech $20
        pitch: "Dishwasher leaks are the #1 hidden source of cabinet and floor rot. A smart sensor under the unit alerts your phone the moment it gets wet." },
      { key: 'garbage_disposal', name: 'Garbage disposal replacement (installed)', price: 209, tech_cut: 99, discount: 10, // unit ~$80 -> net $199: shop $100 (cost+25%), tech $99 (50%)
        pitch: "Since we're already under your sink — swap a leaking or jammed disposal for a fresh unit. Quieter, stronger, and we haul the old one away." },
    ],
    range: [
      { key: 'range_antitip', name: 'Anti-tip safety bracket (installed)', price: 49, tech_cut: 20, discount: 10, // bracket ~$15 -> net $39: shop $19, tech $20
        pitch: "Code requires an anti-tip bracket on every range — it stops the stove from tipping if a child climbs or leans on an open door. Most homes are missing it. We'll secure yours while we're there." },
      { key: 'range_hood_filter', name: 'Fresh range-hood filter (installed)', price: 49, tech_cut: 20, discount: 10, // grease+charcoal ~$15 -> net $39: shop $19, tech $20
        pitch: "A clogged hood filter is a grease-fire risk and kills your ventilation. We'll drop in a fresh grease + charcoal filter while we're there." },
    ],
  };
  // NOTE: full dryer VENT cleaning (the long run to the roof/side) is NOT a
  // fixed portal offer — too many variables (length, rooftop vs side). It's
  // tech-quoted on site from Teddy's length/rooftop price list.

  // Deal of the week — one rotating special, auto-advancing by calendar week.
  // `normal` is the everyday portal net (honest anchor — never inflated), `sale`
  // is the marked-down price. The shop gives up its margin as the promo; the
  // tech still earns their full cut, so `sale` always covers part cost + cut.
  // Only items with deal room are featured (service + the premium kit).
  var WEEKLY_DEALS = [
    { key: 'dryer_cleanout', name: 'Dryer clean-out', normal: 70, sale: 50,
      pitch: "Lint build-up is the #1 dryer fire risk and makes everything take longer to dry. This week we'll give your tech extra time to do a full clean-out — just let us know." },
    { key: 'fridge_coil_clean', name: 'Refrigerator condenser coil cleaning', normal: 70, sale: 50,
      pitch: "Dirty coils raise your energy bill and shorten your fridge's life. Full blow-out + vac, on special this week." },
    { key: 'dryer_vent_magnetic', name: 'Magnetic quick-connect vent kit, installed', normal: 69, sale: 55,
      pitch: "Upgrade to an airtight magnetic quick-connect — best airflow + seal, and pulling the dryer out next time is a snap. On special this week." },
    { key: 'fridge_water_filter', name: 'Fresh refrigerator water filter, installed', normal: 59, sale: 50,
      pitch: "Clean water and ice — makers recommend a fresh filter about every 6 months. We'll drop one in, on special this week." },
    { key: 'washer_leak_detector', name: 'Smart water leak detector', normal: 39, sale: 33,
      pitch: "A smart sensor behind your washer texts your phone the second it senses water — cheap insurance against a leaking valve. On special this week." },
  ];

  // ISO-week number, so the deal advances once a week consistently.
  function isoWeek(d) {
    d = d || new Date();
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    var first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  function dealOfTheWeek() {
    if (!WEEKLY_DEALS.length) return null;
    return WEEKLY_DEALS[isoWeek() % WEEKLY_DEALS.length];
  }

  // Map loose appliance text to a catalog key.
  function normalize(appl) {
    var a = String(appl || '').toLowerCase();
    if (/dish|disposal/.test(a)) return 'dishwasher';
    if (/wash/.test(a)) return 'washer';
    if (/dry/.test(a)) return 'dryer';
    if (/fridge|refriger|freezer/.test(a)) return 'refrigerator';
    if (/range|stove|oven|cooktop/.test(a)) return 'range';
    return '';
  }

  function forAppliance(appl) {
    var key = normalize(appl);
    return (CATALOG[key] || []).slice();
  }
  function get(key) {
    for (var k in CATALOG) { for (var i = 0; i < CATALOG[k].length; i++) { if (CATALOG[k][i].key === key) return CATALOG[k][i]; } }
    return null;
  }

  root.AntAddons = { CATALOG: CATALOG, WEEKLY_DEALS: WEEKLY_DEALS, forAppliance: forAppliance, get: get, normalize: normalize, dealOfTheWeek: dealOfTheWeek, isoWeek: isoWeek };
})(window);
