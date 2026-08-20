'use strict';
// symptom-canon — map a messy free-text symptom to a small controlled vocabulary per
// appliance, so model+symptom actually CLUSTERS. "not cleaning" / "won't clean" / "dishes
// still dirty" / "leaving residue" are one problem described four ways; without this the
// brain can't aggregate 50 jobs into one confident answer. Reliability lever #1 for the
// four-field knowledge row { model, symptom, solved_parts[], did_not_solve_parts[] }.
// Pure, dependency-free, never throws — returns a canonical slug (or a cleaned fallback).

// Per-appliance taxonomy: [canonical_name, matcher]. First match wins (order = priority).
const TAXONOMY = {
  dishwasher: [
    ['not-draining', /drain|standing water|won'?t empty|water in (the )?bottom|not pump/],
    ['not-filling', /won'?t fill|not fill|no water|not getting water/],
    ['not-cleaning', /clean|dirty|residue|film|spot|not wash|doesn'?t wash|grimy|gritty|chalk/],
    ['not-drying', /not dry|wet dish|won'?t dry|damp/],
    ['leaking', /leak|water on (the )?floor|dripping|puddle/],
    ['no-power', /no power|won'?t start|dead|no light|not turning on|won'?t turn on|unrespons/],
    ['noise', /nois|loud|grind|buzz|hum|rattl/],
    ['error-code', /error|code|fault|\bf\d|\be\d|blink|flash/],
    ['not-starting-cycle', /won'?t run|not running|cycle|stuck/],
  ],
  refrigerator: [
    ['freezer-not-freezing', /freezer.*(warm|not freez|not cold|too warm)|not freezing/],
    ['not-cooling', /not cool|warm|not cold|too warm|fresh food|not getting cold|temp too/],
    ['ice-maker', /ice maker|icemaker|no ice|not making ice|ice/],
    ['water-dispenser', /water dispenser|not dispens|no water from/],
    ['leaking', /leak|water on (the )?floor|puddle/],
    ['running-constant', /run(ning)? (all the time|constant|non.?stop|too much)|never shuts? off/],
    ['not-running', /not running|dead|no power|won'?t start|completely off/],
    ['frost-defrost', /frost|ice build|defrost|freezing up|frozen coil/],
    ['noise', /nois|loud|buzz|hum|rattl|click/],
  ],
  washer: [
    ['not-draining', /drain|won'?t empty|standing water|not pump/],
    ['not-spinning', /spin/],
    ['not-agitating', /agitat|not moving|not wash|won'?t tumbl/],
    ['not-filling', /won'?t fill|not fill|no water/],
    ['no-power', /no power|won'?t start|dead|no light|not turning on|unrespons|won'?t come on/],
    ['leaking', /leak|water on (the )?floor/],
    ['door-lock', /door|lid|lock|latch/],
    ['smell', /smell|odor|mildew|mold/],
    ['noise', /nois|loud|bang|grind|buzz|rattl/],
    ['error-code', /error|code|fault|\bf\d|\be\d/],
  ],
  dryer: [
    ['not-heating', /no heat|not heat|cold|wet|damp|takes (forever|two|2|long|3|multiple)|won'?t dry|not dry/],
    ['not-tumbling', /tumbl|drum|not turn|not spin/],
    ['tripping-breaker', /breaker|trip|blow(s|ing)? (a )?fuse/],
    ['shuts-off', /shuts? off|stops? (early|mid)|turns? off/],
    ['smell', /smell|burn|odor/],
    ['no-power', /no power|won'?t start|dead|no light|not turning on|unrespons/],
    ['noise', /nois|loud|squeal|thump|grind|rattl/],
    ['error-code', /error|code|fault|\bf\d|\be\d|\bd\d\d/],
  ],
  oven: [
    ['not-heating', /no heat|not heat|won'?t heat|not getting hot|stays cold/],
    ['not-reaching-temp', /temp|not hot enough|takes long to (heat|preheat)|under.?heat|over.?heat/],
    ['burner-issue', /burner|element|coil|igniter|won'?t light|not light|surface/],
    ['no-power', /no power|won'?t (start|turn on)|dead|no display/],
    ['uneven-bake', /uneven|burn|not cook(ing)? even/],
    ['self-clean', /self.?clean|clean cycle|locked/],
    ['door', /door|hinge|glass|seal/],
    ['error-code', /error|code|fault|\bf\d|\be\d/],
  ],
  microwave: [
    ['not-heating', /no heat|not heat|not warm|cold|won'?t cook|not cooking/],
    ['sparking', /spark|arc|fire|smok/],
    ['no-power', /no power|dead|won'?t (start|turn on)|no display/],
    ['turntable', /turntable|plate|not spin/],
    ['door', /door|latch/],
    ['noise', /nois|loud|buzz|grind/],
  ],
};

function applKey(a) {
  a = String(a || '').toLowerCase();
  if (/dish/.test(a)) return 'dishwasher';
  if (/fridge|refrig|freezer/.test(a)) return 'refrigerator';
  if (/wash/.test(a)) return 'washer';
  if (/dry/.test(a)) return 'dryer';
  if (/oven|range|stove|cooktop/.test(a)) return 'oven';
  if (/micro/.test(a)) return 'microwave';
  return '';
}
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28); }

// canonSymptom(appliance, freeText) -> canonical slug (controlled vocab), or a cleaned
// fallback slug when nothing matches (still better than raw text; never empty).
function canonSymptom(appliance, text) {
  const t = String(text || '').toLowerCase();
  const ak = applKey(appliance);
  if (ak && TAXONOMY[ak]) { for (const [name, re] of TAXONOMY[ak]) { if (re.test(t)) return name; } }
  // appliance-agnostic fallbacks
  if (/error|code|fault|\bf\d|\be\d/.test(t)) return 'error-code';
  if (/no power|won'?t (start|turn on)|dead|not turning on/.test(t)) return 'no-power';
  if (/leak/.test(t)) return 'leaking';
  if (/nois|loud/.test(t)) return 'noise';
  return slug(t) || 'unknown';
}

module.exports = { canonSymptom, applKey };
