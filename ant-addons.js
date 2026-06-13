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
  // Prices raised $10 + rounded up to clean $10s (no 9-endings) per Teddy
  // 2026-06-13. `price` is the sticker; net = price - discount is what they pay.
  var CATALOG = {
    washer: [
      { key: 'washer_supply_lines', name: 'New washer supply lines', price: 60, tech_cut: 20, discount: 10, ship_price: 30, ship_cut: 10, // installed net $50/t$20; ship-only net $30/t$10
        pitch: "Burst or leaking washer hoses are a top cause of home water damage, and most makers recommend replacing them about every 5 years." },
      { key: 'washer_leak_detector', name: 'Smart water leak detector', price: 110, tech_cut: 50, discount: 10, ship_price: 80, ship_cut: 20, // installed net $100/t$50 (done first visit, no 2nd trip); ship-only net $80/t$20
        pitch: "A smart sensor sits behind your washer and alerts your phone the second it senses water — leaking valves and hoses cause some of the priciest damage we see. Cheap insurance." },
    ],
    dryer: [
      { key: 'dryer_cleanout', name: 'Dryer clean-out', price: 90, tech_cut: 35, discount: 10, // service, no part -> net $80, tech $35
        pitch: "Lint build-up is the #1 dryer fire risk and makes everything take longer to dry. We'll do a full clean-out while we're there — quick and worth it." },
      { key: 'dryer_vent_hose', name: 'New dryer vent hose', price: 60, tech_cut: 20, discount: 10, ship_price: 30, ship_cut: 10, // installed net $50/t$20; ship-only net $30/t$10
        pitch: "A fresh vent hose means better airflow and a safer dryer." },
      { key: 'dryer_vent_magnetic', name: 'Magnetic quick-connect vent kit', price: 90, tech_cut: 20, discount: 10, ship_price: 55, ship_cut: 10, // installed net $80/t$20; ship-only net $55/t$10
        pitch: "Upgrade to an airtight magnetic quick-connect — best airflow and seal, and makes pulling the dryer out a snap next time." },
    ],
    refrigerator: [
      { key: 'fridge_coil_clean', name: 'Condenser coil vac + blow-out', price: 90, tech_cut: 35, discount: 10, // service, no part -> net $80, tech $35
        pitch: "Dirty condenser coils shorten your fridge's life and raise your energy bill. We'll vac + blow them out while we're there — recommended every 6-12 months." },
      { key: 'fridge_supply_line', name: 'New fridge water/ice line', price: 60, tech_cut: 20, discount: 10, ship_price: 30, ship_cut: 10, // installed net $50/t$20; ship-only net $30/t$10
        pitch: "The water line behind the fridge is a common hidden leak source — cheap protection against a slow leak under your floor." },
      { key: 'fridge_water_filter', name: 'Fresh water filter (installed)', inquire: true, tech_cut: 0, discount: 0, // OEM filter cost varies by brand -> quoted to the model
        pitch: "Clean water and ice — manufacturers recommend a new filter about every 6 months. Ask us and we'll quote the right filter for your model and drop it in while we're there." },
      { key: 'fridge_leak_detector', name: 'Smart water leak detector', price: 110, tech_cut: 50, discount: 10, ship_price: 80, ship_cut: 20, // installed net $100/t$50 (done first visit, no 2nd trip); ship-only net $80/t$20
        pitch: "A smart sensor under your fridge catches an ice-maker or water-line leak before it ruins your floor — and texts your phone, not just beeps in an empty kitchen." },
    ],
    dishwasher: [
      { key: 'dishwasher_supply_line', name: 'New dishwasher supply line (installed)', price: 130, tech_cut: 60, discount: 10, // pull unit + under-sink shutoff -> net $120: 50% split, tech $60
        pitch: "The dishwasher supply line runs under your cabinet where a slow leak goes unseen for months. Replacing it means pulling the unit and working the shutoff — worth doing right while we're already in there." },
      { key: 'dishwasher_leak_detector', name: 'Smart water leak detector', price: 110, tech_cut: 50, discount: 10, ship_price: 80, ship_cut: 20, // installed net $100/t$50 (done first visit, no 2nd trip); ship-only net $80/t$20
        pitch: "Dishwasher leaks are the #1 hidden source of cabinet and floor rot. A smart sensor under the unit alerts your phone the moment it gets wet." },
      { key: 'garbage_disposal', name: 'Garbage disposal replacement', inquire: true, tech_cut: 0, discount: 0, // quoted on site (varies by unit/install)
        pitch: "Since we're already under your sink — ask us about swapping a leaking or jammed disposal for a fresh unit. We'll quote it on the spot." },
    ],
    range: [
      { key: 'range_antitip', name: 'Anti-tip safety bracket (installed)', price: 110, tech_cut: 50, discount: 10, // safety/code item -> net $100: 50% split, tech $50
        pitch: "Code requires an anti-tip bracket on every range — it stops the stove from tipping if a child climbs or leans on an open door. Most homes are missing it. We'll secure yours while we're there." },
      { key: 'range_hood_filter', name: 'Fresh range-hood filter', price: 60, tech_cut: 20, discount: 10, ship_price: 30, ship_cut: 10, // installed net $50/t$20; ship-only net $30/t$10
        pitch: "A clogged hood filter is a grease-fire risk and kills your ventilation. A fresh grease + charcoal filter is an easy swap." },
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
    { key: 'dryer_cleanout', name: 'Dryer clean-out', normal: 80, sale: 60,
      pitch: "Lint build-up is the #1 dryer fire risk and makes everything take longer to dry. This week we'll give your tech extra time to do a full clean-out — just let us know." },
    { key: 'fridge_coil_clean', name: 'Refrigerator condenser coil cleaning', normal: 80, sale: 60,
      pitch: "Dirty coils raise your energy bill and shorten your fridge's life. Full blow-out + vac, on special this week." },
    { key: 'dryer_vent_magnetic', name: 'Magnetic quick-connect vent kit, installed', normal: 80, sale: 60,
      pitch: "Upgrade to an airtight magnetic quick-connect — best airflow + seal, and pulling the dryer out next time is a snap. On special this week." },
    { key: 'fridge_supply_line', name: 'Refrigerator water/ice line, installed', normal: 50, sale: 40,
      pitch: "The line behind your fridge is a common hidden leak source. Cheap protection against a slow leak under your floor — on special this week." },
    { key: 'washer_leak_detector', name: 'Smart water leak detector, installed', normal: 100, sale: 80,
      pitch: "A smart sensor behind your washer texts your phone the second it senses water — cheap insurance against a leaking valve. Installed, on special this week." },
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
