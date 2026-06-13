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

  // Customer-portal add-on offers: "$10 off, shipped with your repair." Office
  // just orders + ships the item with the parts order. Prices/discount are easy
  // to tune — Teddy, set these to your real numbers.
  var DISCOUNT = 10; // $ off when added through the portal
  var CATALOG = {
    washer: [
      { key: 'washer_supply_lines', name: 'New washer supply lines', price: 49, discount: 10,
        pitch: "Burst or leaking washer hoses are a top cause of home water damage, and most makers recommend replacing them about every 5 years. We'll ship a fresh set with your repair." },
    ],
    dryer: [
      { key: 'dryer_vent_clean', name: 'Dryer vent cleaning kit', price: 89, discount: 10,
        pitch: "Clogged dryer vents make your dryer work harder and cause ~15,000 home fires a year. Recommended yearly." },
      { key: 'dryer_vent_hose', name: 'New dryer vent hose', price: 35, discount: 10,
        pitch: "Swap an old or crushed vent hose for better airflow and safety — shipped with your repair." },
    ],
    refrigerator: [
      { key: 'fridge_coil_clean', name: 'Condenser coil cleaning kit', price: 49, discount: 10,
        pitch: "Dirty condenser coils shorten your fridge's life and raise your energy bill. Recommended every 6–12 months." },
      { key: 'fridge_supply_line', name: 'New fridge water / ice line', price: 39, discount: 10,
        pitch: "The water line behind the fridge is a common hidden leak source — cheap protection against a slow leak under your floor." },
      { key: 'fridge_water_filter', name: 'Fresh water filter', price: 45, discount: 10,
        pitch: "Clean water and ice — manufacturers recommend a new filter about every 6 months. We'll ship one with your repair." },
    ],
  };

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

  root.AntAddons = { CATALOG: CATALOG, forAppliance: forAppliance, get: get, normalize: normalize };
})(window);
