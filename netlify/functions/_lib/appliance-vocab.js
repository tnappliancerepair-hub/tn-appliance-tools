// appliance-vocab — the one canonical "what appliance is this" vocabulary.
//
// Hoisted out of _lib/appliance-split so a PLATFORM-native function can use it without
// dragging in the Xano metadata-crud dependency that appliance-split needs. Same reason
// _lib/part-match exists: a second copy of a matching rule drifts, and the two copies
// disagree exactly when it costs money. One rule, two callers.
//
// ⚠️ ORDER MATTERS. "dishwasher" contains the substring "washer", so dishwasher MUST be
// tested before washer or every dishwasher reads as a washer. Multi-word keywords come
// before their single-word forms for the same reason.
'use strict';

const APPLIANCES = [
  { canon: 'refrigerator', kw: ['refrigerator', 'fridge'] },
  { canon: 'freezer', kw: ['freezer'] },
  { canon: 'dishwasher', kw: ['dish washer', 'dishwasher'] },
  { canon: 'washer', kw: ['washing machine', 'washer'] },
  { canon: 'dryer', kw: ['dryer'] },
  { canon: 'range', kw: ['range', 'stove', 'cooktop', 'wall oven', 'oven'] },
  { canon: 'microwave', kw: ['microwave'] },
  { canon: 'disposal', kw: ['garbage disposal', 'disposal'] },
];

// "Samsung washer" and "washer" are the SAME machine — the brand is not the identity.
// Returns null when the text names no appliance we recognise, which callers must treat as
// "I don't know what this is", never as a machine of its own.
function segToAppliance(seg) {
  const s = String(seg || '').toLowerCase();
  for (const a of APPLIANCES) for (const k of a.kw) if (s.includes(k)) return a.canon;
  return null;
}

module.exports = { APPLIANCES, segToAppliance };
