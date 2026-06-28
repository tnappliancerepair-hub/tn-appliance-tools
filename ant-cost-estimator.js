/* ant-cost-estimator.js — interactive flat-rate estimator widget.
 * Mounts into <div id="ant-cost-estimator" data-appliance="dryer" [data-repair="key"]></div>.
 * Pick a repair -> our flat labor vs the national all-in average + Quick Check CTA.
 * DATA mirrors netlify/functions/_lib/repair-menu.js (flat_labor / NAT_AVG). If those
 * prices change, update here too. Only repairs where we beat national are listed.
 * Honest framing: ours = flat LABOR (part shown after diagnosis); theirs = all-in avg. */
(function () {
  'use strict';
  // [key, label, ourFlatLabor, nationalAllIn]
  var R = {
    dryer: [['Heating element', 120, 230], ['Belt', 135, 175], ['Thermal fuse / thermostat', 100, 115], ['Control / main board', 205, 375]],
    washer: [['Drain pump', 150, 225], ['Door lock / lid switch', 125, 200], ['Shocks / suspension', 150, 225], ['Drive motor / clutch', 205, 400], ['Control / main board', 205, 375]],
    refrigerator: [['Ice maker', 140, 260], ['Door gasket / seal', 120, 200], ['Compressor / sealed system', 525, 975], ['Water line / dispenser', 135, 195], ['Water inlet valve', 115, 175], ['Evaporator / condenser fan', 170, 325], ['Defrost system', 170, 300], ['Thermostat / temp control', 130, 200], ['Control / main board', 205, 375]],
    dishwasher: [['Drain pump', 135, 175], ['Wash pump / motor', 180, 275], ['Water inlet valve', 120, 175], ['Supply line / leak', 135, 175], ['Control / main board', 205, 375]],
    oven: [['Bake / broil element', 130, 250], ['Surface burner / element', 130, 225], ['Oven igniter', 130, 235], ['Control / main board', 205, 375]],
    all: [['Refrigerator ice maker', 140, 260], ['Dryer heating element', 120, 230], ['Washer drain pump', 150, 225], ['Dishwasher drain pump', 135, 175], ['Oven bake element', 130, 250], ['Control / main board', 205, 375]]
  };
  // preselect key -> the row label to default to, per data-repair shorthand
  var PRE = {
    dryer_heating_element: 'Heating element', dryer_belt: 'Belt', dryer_thermal: 'Thermal fuse / thermostat',
    washer_drain_pump: 'Drain pump', washer_door_lock: 'Door lock / lid switch', washer_shocks: 'Shocks / suspension', washer_motor: 'Drive motor / clutch',
    fridge_ice_maker: 'Ice maker', fridge_door_gasket: 'Door gasket / seal', fridge_water_valve: 'Water inlet valve', fridge_evap_fan: 'Evaporator / condenser fan', fridge_temp_control: 'Thermostat / temp control',
    dw_drain_pump: 'Drain pump', dw_wash_pump: 'Wash pump / motor', dw_supply_line: 'Supply line / leak',
    oven_bake_element: 'Bake / broil element', oven_surface: 'Surface burner / element', oven_igniter: 'Oven igniter',
    control_board: 'Control / main board'
  };
  var APPL_PARAM = { dryer: 'dryer', washer: 'washer', refrigerator: 'refrigerator', dishwasher: 'dishwasher', oven: 'oven' };

  function css() {
    if (document.getElementById('ace-css')) return;
    var s = document.createElement('style'); s.id = 'ace-css';
    s.textContent = [
      '.ace-card{margin-top:18px;border:1px solid var(--bord2,#252525);border-radius:14px;background:var(--surface,#0c0c0c);padding:22px}',
      '.ace-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}',
      '.ace-sel{flex:1;min-width:200px;background:var(--surf2,#111);color:var(--white,#f0f0f0);border:1px solid var(--bord2,#252525);border-radius:9px;padding:13px 14px;font-family:inherit;font-size:15px;-webkit-appearance:none;appearance:none}',
      '.ace-out{margin-top:18px}',
      '.ace-amts{display:flex;gap:12px;flex-wrap:wrap}',
      '.ace-box{flex:1;min-width:150px;border:1px solid var(--bord2,#252525);border-radius:11px;padding:16px}',
      '.ace-box .k{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--gray,#888);margin-bottom:7px}',
      '.ace-ours .v{font-family:var(--block,sans-serif);font-size:30px;color:var(--orange,#ff6200);line-height:1}',
      '.ace-nat .v{font-family:var(--block,sans-serif);font-size:30px;color:var(--gray,#888);line-height:1}',
      '.ace-ours{border-color:rgba(255,98,0,.4)}',
      '.ace-part{font-size:12.5px;color:var(--gray,#888);margin-top:11px;line-height:1.6}',
      '.ace-badge{display:inline-block;margin-top:12px;font-size:12.5px;color:var(--green,#39ff14);border:1px solid rgba(57,255,20,.25);background:rgba(57,255,20,.05);border-radius:8px;padding:8px 12px;line-height:1.5}',
      '.ace-cta{display:inline-flex;align-items:center;gap:8px;margin-top:16px;background:var(--orange,#ff6200);color:#000;font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;padding:13px 20px;border-radius:10px;text-decoration:none}',
      '.ace-cta:hover{filter:brightness(1.08)}'
    ].join('');
    document.head.appendChild(s);
  }

  function money(n) { return '$' + n; }

  function mount(el) {
    var appl = (el.getAttribute('data-appliance') || 'all').toLowerCase();
    var list = R[appl] || R.all;
    var preKey = el.getAttribute('data-repair') || '';
    var preLabel = PRE[preKey] || '';
    var startIdx = 0;
    for (var i = 0; i < list.length; i++) { if (list[i][0] === preLabel) { startIdx = i; break; } }

    var opts = list.map(function (r, i) { return '<option value="' + i + '"' + (i === startIdx ? ' selected' : '') + '>' + r[0] + '</option>'; }).join('');
    var ctaHref = '/appliance-ai.html' + (APPL_PARAM[appl] ? ('?appliance=' + APPL_PARAM[appl]) : '');

    el.innerHTML =
      '<div class="ace-card">' +
        '<div class="ace-row"><select class="ace-sel" aria-label="Choose a repair">' + opts + '</select></div>' +
        '<div class="ace-out"></div>' +
      '</div>';
    var sel = el.querySelector('.ace-sel');
    var out = el.querySelector('.ace-out');

    function render() {
      var r = list[parseInt(sel.value, 10) || 0];
      var ours = r[1], nat = r[2];
      out.innerHTML =
        '<div class="ace-amts">' +
          '<div class="ace-box ace-ours"><div class="k">Our flat labor</div><div class="v">' + money(ours) + '</div></div>' +
          '<div class="ace-box ace-nat"><div class="k">Typical shop, all-in</div><div class="v">~' + money(nat) + '</div></div>' +
        '</div>' +
        '<div class="ace-part">We quote a flat labor price by the job, then add the exact part <b>at our real cost</b> &mdash; you see the number (most shops never show it). The national figure bundles parts + labor with the markup hidden inside.</div>' +
        '<div class="ace-badge">✅ Flat ' + money(ours) + ' labor &mdash; well under the ~' + money(nat) + ' most shops charge all-in. Your $50 Quick Check credits straight to the repair.</div>' +
        '<div><a class="ace-cta" href="' + ctaHref + '">Get your exact price → $50 Quick Check</a></div>';
    }
    sel.addEventListener('change', render);
    render();
  }

  function init() {
    var els = document.querySelectorAll('#ant-cost-estimator, .ant-cost-estimator');
    if (!els.length) return;
    css();
    Array.prototype.forEach.call(els, mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
