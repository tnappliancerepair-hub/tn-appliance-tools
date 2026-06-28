// repair-menu.js — the flat-rate repair price-book (single source of truth).
//
// MODEL (Teddy 2026-06-28): price BY THE JOB. Each repair has a FLAT LABOR number
// calibrated to ~$100/hr on the REAL job time (heavy jobs bumped up from the old
// warranty-minimized times). The PART is NOT flat — it auto-fills live from Marcone
// at cost ÷ .75 (Danielle's formula). All-in = flat_labor + part_sell.
//
// flat_labor here = DEFAULTS seeded from 8 yrs of history; Teddy approves/edits each.
// `confirm:true` flags the ones whose historical time was too low (verify the price).
// Parts formula: cost ÷ .75 at $30+, else cost + $10 (warranty parts: no markup).
'use strict';

// parts pricing rule
function sellPrice(costUsd, { warranty = false } = {}) {
  const c = Number(costUsd) || 0;
  if (warranty || c <= 0) return c; // warranty parts billed at cost (vendor supplies)
  return c >= 30 ? Math.round((c / 0.75) * 100) / 100 : Math.round((c + 10) * 100) / 100;
}

// service-call / diagnostic (rolls into the repair if they proceed)
const SERVICE_CALL = { key: 'service_call', label: 'Service call / diagnostic', flat_labor: 95, note: 'rolls into the repair if approved' };

// repair price-book. flat_labor = DEFAULT (approve/edit). common_parts from history.
const REPAIRS = [
  // 🧊 Refrigerator
  { key: 'fridge_ice_maker', appliance: 'Refrigerator', label: 'Ice maker', flat_labor: 110, common_parts: ['W10873791', 'WR30X35285', 'ACZ74170502', 'AEQ73449909'] },
  { key: 'fridge_door_gasket', appliance: 'Refrigerator', label: 'Door gasket / seal', flat_labor: 110, common_parts: ['WD08X10057', 'WR14X27230'] },
  { key: 'fridge_compressor', appliance: 'Refrigerator', label: 'Compressor / sealed system', flat_labor: 375, confirm: true, common_parts: ['W10503278', 'W10594330'] },
  { key: 'fridge_water_line', appliance: 'Refrigerator', label: 'Water line / dispenser', flat_labor: 130, common_parts: ['WP3385089', 'W11465533'] },
  { key: 'fridge_water_valve', appliance: 'Refrigerator', label: 'Water inlet valve', flat_labor: 110, common_parts: ['W11025984', 'WPW10179146'] },
  { key: 'fridge_evap_fan', appliance: 'Refrigerator', label: 'Evaporator / condenser fan', flat_labor: 140, common_parts: ['W11671461', 'ADQ73913310'] },
  { key: 'fridge_defrost', appliance: 'Refrigerator', label: 'Defrost system (heater/thermostat)', flat_labor: 140, common_parts: [] },
  { key: 'fridge_temp_control', appliance: 'Refrigerator', label: 'Thermostat / temp control', flat_labor: 110, common_parts: [] },
  // 🌀 Washer
  { key: 'washer_drain_pump', appliance: 'Washer', label: 'Drain pump', flat_labor: 130, common_parts: ['WH01X32580', 'WPW10276397'] },
  { key: 'washer_bearing', appliance: 'Washer', label: 'Bearing / spider / tub', flat_labor: 300, confirm: true, common_parts: ['W11643701', 'W11335100'] },
  { key: 'washer_door_lock', appliance: 'Washer', label: 'Door lock / lid switch', flat_labor: 120, common_parts: ['W10653840', 'W11589973'] },
  { key: 'washer_shocks', appliance: 'Washer', label: 'Shocks / suspension', flat_labor: 130, common_parts: ['ACV72909503'] },
  { key: 'washer_motor', appliance: 'Washer', label: 'Drive motor / clutch', flat_labor: 160, common_parts: ['WE17X10010'] },
  // 🔥 Dryer
  { key: 'dryer_heating_element', appliance: 'Dryer', label: 'Heating element', flat_labor: 110, common_parts: ['WD22X10063', 'W11025156'] },
  { key: 'dryer_belt', appliance: 'Dryer', label: 'Belt', flat_labor: 130, common_parts: ['WH16X26911', 'WH01X24180'] },
  { key: 'dryer_thermal', appliance: 'Dryer', label: 'Thermal fuse / thermostat', flat_labor: 100, common_parts: ['WE04X36457', 'W10258275'] },
  // 🍽️ Dishwasher
  { key: 'dw_drain_pump', appliance: 'Dishwasher', label: 'Drain pump', flat_labor: 130, common_parts: [] },
  { key: 'dw_wash_pump', appliance: 'Dishwasher', label: 'Wash pump / motor', flat_labor: 160, common_parts: [] },
  { key: 'dw_water_valve', appliance: 'Dishwasher', label: 'Water inlet valve', flat_labor: 110, common_parts: [] },
  { key: 'dw_supply_line', appliance: 'Dishwasher', label: 'Supply line / leak', flat_labor: 130, common_parts: ['W11454372', 'W11162042'] },
  // ♨️ Range / Oven
  { key: 'oven_bake_element', appliance: 'Range/Oven', label: 'Bake / broil element', flat_labor: 120, common_parts: ['WB23M24', 'AEB73944601'] },
  { key: 'oven_surface', appliance: 'Range/Oven', label: 'Surface burner / element / switch', flat_labor: 120, common_parts: ['WB30X47331', 'WB24T10022'] },
  { key: 'oven_igniter', appliance: 'Range/Oven', label: 'Oven igniter', flat_labor: 110, common_parts: ['WP8054129', 'WR55X26671'] },
  // 🔧 Cross-appliance
  { key: 'control_board', appliance: 'Any', label: 'Control / main board', flat_labor: 120, common_parts: ['W11395618'] },
  { key: 'user_interface', appliance: 'Any', label: 'User interface / display / panel', flat_labor: 110, common_parts: ['W10539780', 'WR55X11144'] },
  { key: 'door_full', appliance: 'Any', label: 'Full door replacement', flat_labor: 150, confirm: true, common_parts: ['W11551301'] },
];

function byKey(k) { return REPAIRS.find((r) => r.key === k) || null; }

module.exports = { REPAIRS, SERVICE_CALL, byKey, sellPrice };
