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
    ],
  };
  // NOTE: full dryer VENT cleaning (the long run to the roof/side) is NOT a
  // fixed portal offer — too many variables (length, rooftop vs side). It's
  // tech-quoted on site from Teddy's length/rooftop price list.

  // Deal of the week — a single 50%-off promo that rotates automatically by
  // calendar week and shows in every customer's portal. Edit the list / prices
  // freely; it cycles through them one per week, no weekly maintenance.
  var WEEKLY_DEALS = [
    { key: 'dryer_cleanout', name: 'Dryer clean-out', normal: 150, sale: 75,
      pitch: "Lint build-up is the #1 dryer fire risk and makes everything take longer to dry. Just let us know and we'll give your tech extra time to do a full clean-out while they're there." },
    { key: 'dryer_vent_hose', name: 'Dryer vent hose, installed', normal: 60, sale: 30,
      pitch: "A fresh vent hose means better airflow and a safer dryer — installed for half off this week." },
    { key: 'fridge_supply_line', name: 'Refrigerator water/ice supply line', normal: 60, sale: 30,
      pitch: "The line behind your fridge is a common hidden leak source. Cheap protection against a slow leak under your floor — half off this week." },
    { key: 'washer_supply_lines', name: 'Washer supply lines', normal: 90, sale: 45,
      pitch: "Burst washer hoses are a top cause of home water damage; makers recommend replacing about every 5 years. Half off this week." },
    { key: 'fridge_coil_clean', name: 'Refrigerator condenser coil cleaning', normal: 90, sale: 45,
      pitch: "Dirty coils raise your energy bill and shorten your fridge's life. Half off a full blow-out + vac this week." },
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
    if (/dish/.test(a)) return 'dishwasher';
    if (/wash/.test(a)) return 'washer';
    if (/dry/.test(a)) return 'dryer';
    if (/fridge|refriger|freezer/.test(a)) return 'refrigerator';
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
