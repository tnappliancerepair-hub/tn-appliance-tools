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
  // Each carries the customer price AND the tech's cut (techs earn for low-risk
  // work + their time). 50% split on the service items; flat cut on hoses.
  // Prices marked TODO need the real part cost — Teddy is pulling those.
  var DISCOUNT = 10; // $ off when added through the portal
  var CATALOG = {
    washer: [
      { key: 'washer_supply_lines', name: 'New washer supply lines (installed)', price: 59, tech_cut: 20, discount: 10, // braided pair ~$20 part + markup + $20 tech
        pitch: "Burst or leaking washer hoses are a top cause of home water damage, and most makers recommend replacing them about every 5 years. We'll install a fresh set while we're there." },
    ],
    dryer: [
      { key: 'dryer_cleanout', name: 'Dryer clean-out', price: 70, tech_cut: 35, discount: 10, // $70 / 50% split -> tech $35, 15-30 min
        pitch: "Lint build-up is the #1 dryer fire risk and makes everything take longer to dry. We'll do a full clean-out while we're there — quick and worth it." },
      { key: 'dryer_vent_hose', name: 'New dryer vent hose (installed)', price: 49, tech_cut: 20, discount: 10, // transition hose ~$15 part + markup + $20 tech
        pitch: "A fresh vent hose means better airflow and a safer dryer — installed while we're there." },
    ],
    refrigerator: [
      { key: 'fridge_coil_clean', name: 'Condenser coil vac + blow-out', price: 70, tech_cut: 35, discount: 10, // $70 / 50% split -> tech $35
        pitch: "Dirty condenser coils shorten your fridge's life and raise your energy bill. We'll vac + blow them out while we're there — recommended every 6-12 months." },
      { key: 'fridge_supply_line', name: 'New fridge water/ice line (installed)', price: 49, tech_cut: 20, discount: 10, // braided line kit ~$15 part + markup + $20 tech
        pitch: "The water line behind the fridge is a common hidden leak source — cheap protection against a slow leak under your floor." },
      { key: 'fridge_water_filter', name: 'Fresh water filter (installed)', price: 49, tech_cut: 15, discount: 10, // OEM filter cost varies $20-50; confirm per brand
        pitch: "Clean water and ice — manufacturers recommend a new filter about every 6 months. We'll drop one in while we're there." },
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
