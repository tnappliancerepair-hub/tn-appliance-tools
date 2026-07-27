// content-series — the "channel" layer of the Video Studio. Turns a feed into
// recognizable FRANCHISES (Fix or Toss?, What killed it?, Model # -> the part,
// Fault-code explainer) and grounds each clip in REAL repair data (the moat).
//
// Two exports:
//   SERIES               — the preset config (label, hook flavor, title, CTA, tags)
//   groundedFacts(opts)   — pull real corpus stats for a clip (async, best-effort)
//   inferAppliance(text)  — guess the appliance from a title/transcript
'use strict';
const menu = require('./repair-menu');

// Honest public retail ballpark to REPLACE a unit (2025-26, general market) — used
// only as a range for the "toss" side of Fix-or-Toss, never as a claim about a
// specific machine.
const NEW_UNIT_RANGE = {
  Refrigerator: [1000, 3000], Washer: [600, 1300], Dryer: [600, 1300],
  Dishwasher: [500, 1200], 'Range/Oven': [700, 2000], Microwave: [200, 600],
};

// Each series drives: the burned on-screen HOOK flavor, the SEO title pattern,
// the CTA, hashtags, and whether to lead with a real-data stat. {topic}/{appliance}/
// {brand}/{symptom}/{code} are filled by the brain from what it knows.
const SERIES = {
  hero: {
    key: 'hero', label: '⭐ Hero — the tech on camera', emoji: '⭐',
    hook_flavor: 'a human moment or a tiny mystery — the person, not the task',
    title_pattern: '{topic}', cta: 'call/text us — we answer 24/7',
    hashtags: ['#TNApplianceExchange', '#appliancerepair', '#familyowned'], use_stat: false,
  },
  fix_or_toss: {
    key: 'fix_or_toss', label: '⚖️ Fix or Toss?', emoji: '⚖️',
    hook_flavor: 'a price-shock verdict: what it costs to FIX vs buy new',
    title_pattern: 'Fix or Toss? This {appliance} — is it worth saving?',
    cta: 'not sure on yours? $50 Quick Check tells you straight',
    hashtags: ['#fixortoss', '#appliancerepair', '#worthit', '#TNApplianceExchange'], use_stat: true,
  },
  what_killed_it: {
    key: 'what_killed_it', label: '💀 What killed this appliance?', emoji: '💀',
    hook_flavor: 'a mystery + a satisfying reveal of the real culprit',
    title_pattern: 'What killed this {appliance}? (you won\'t guess it)',
    cta: 'catch it early — text us a video anytime',
    hashtags: ['#whatkilledit', '#appliancerepair', '#satisfying', '#TNApplianceExchange'], use_stat: true,
  },
  model_to_part: {
    key: 'model_to_part', label: '🔎 Model # → the exact part', emoji: '🔎',
    hook_flavor: 'radical transparency — the EXACT part that fixes it (we tell you)',
    title_pattern: '{brand} {appliance}: the exact part that fixes {symptom}',
    cta: 'comment your model # — we\'ll tell you the part',
    hashtags: ['#appliancerepair', '#diyrepair', '#{brand}', '#TNApplianceExchange'], use_stat: true,
  },
  fault_code: {
    key: 'fault_code', label: '🚨 Fault-code explainer', emoji: '🚨',
    hook_flavor: 'the search answer: what the code means + the real fix',
    title_pattern: '{brand} {code} error — what it means + how to fix it',
    cta: 'comment your code + model — we\'ll help',
    hashtags: ['#faultcode', '#appliancerepair', '#{brand}', '#TNApplianceExchange'], use_stat: true,
  },
  quick_tip: {
    key: 'quick_tip', label: '🔧 Quick tip / how-to', emoji: '🔧',
    hook_flavor: 'a save-this promise — a real tip that pays off fast',
    title_pattern: '{topic}',
    cta: 'save this + call the real techs when you need us',
    hashtags: ['#howto', '#DIY', '#appliancerepair', '#TNApplianceExchange'], use_stat: false,
  },
};
const SERIES_ORDER = ['hero', 'fix_or_toss', 'what_killed_it', 'model_to_part', 'fault_code', 'quick_tip'];

// Map the legacy content_type values onto a series so old clips still slot in.
function seriesFor(key) {
  const k = String(key || '').toLowerCase();
  if (SERIES[k]) return SERIES[k];
  if (k === 'talking_head' || k === 'hero') return SERIES.hero;
  if (k === 'quick_tip' || k === 'tip' || k === 'maintenance') return SERIES.quick_tip;
  return SERIES.hero;
}

const APPLIANCES = [
  ['refrigerator', 'Refrigerator'], ['fridge', 'Refrigerator'], ['freezer', 'Refrigerator'],
  ['washer', 'Washer'], ['washing machine', 'Washer'],
  ['dryer', 'Dryer'],
  ['dishwasher', 'Dishwasher'],
  ['oven', 'Range/Oven'], ['range', 'Range/Oven'], ['stove', 'Range/Oven'], ['cooktop', 'Range/Oven'],
  ['microwave', 'Microwave'],
];
function inferAppliance(text) {
  const t = String(text || '').toLowerCase();
  for (const [needle, label] of APPLIANCES) { if (t.includes(needle)) return label; }
  return '';
}

// Best-effort repair cost for an appliance (+ optional component) from the price
// book: match a menu key by appliance and component keyword, else median flat_labor
// for that appliance. Adds a ~$120 typical part estimate for the all-in.
function repairCostFor(appliance, component) {
  const rows = menu.REPAIRS.filter((r) => r.appliance === appliance);
  const pool = rows.length ? rows : menu.REPAIRS;
  let hit = null;
  const comp = String(component || '').toLowerCase();
  if (comp) hit = pool.find((r) => comp.includes(r.label.split(/[\s/]/)[0].toLowerCase()) || r.label.toLowerCase().includes(comp.split(/\s+/)[0]));
  const labor = hit ? hit.flat_labor : Math.round(pool.reduce((a, r) => a + r.flat_labor, 0) / Math.max(1, pool.length));
  const natKey = hit ? hit.key : null;
  const national = natKey && menu.NAT_AVG[natKey] ? menu.NAT_AVG[natKey] : null;
  return { repair_all_in: labor + 120, flat_labor: labor, national, matched: hit ? hit.label : null };
}

// Pull REAL stats for a clip from the repair corpus (via ant-brain-predict) +
// price book. Best-effort: returns { has_stat:false } quietly if nothing solid.
//   opts: { title, appliance?, brand?, model?, symptom?, base? }
async function groundedFacts(opts) {
  opts = opts || {};
  const appliance = opts.appliance || inferAppliance([opts.title, opts.symptom].filter(Boolean).join(' '));
  const out = { appliance, has_stat: false };
  if (!appliance) return out;
  const base = opts.base || 'https://tnapplianceexchange.net/.netlify/functions';
  let pred = null;
  try {
    const r = await fetch(base + '/ant-brain-predict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: opts.brand || '', model: opts.model || '', appliance_type: appliance, symptom: opts.symptom || opts.title || '' }),
    });
    pred = await r.json();
  } catch (_) {}
  const based = (pred && pred.based_on_n) || 0;
  const top = pred && pred.predictions && pred.predictions[0];
  out.based_on_n = based;
  out.scope = pred && pred.scope;
  if (top) { out.top_component = top.component || ''; out.top_part = top.part_display || top.part || ''; out.seen_n = top.seen_n || 0; }
  const cost = repairCostFor(appliance, top && top.component);
  out.repair_all_in = cost.repair_all_in;
  out.national = cost.national;
  out.new_unit_range = NEW_UNIT_RANGE[appliance] || null;
  // "has_stat" = we have enough real signal to lead with a number honestly.
  out.has_stat = based >= 3;
  return out;
}

// A short human proof line grounded in facts (only when honest). Used as the
// caption trust line + a candidate on-screen line.
function proofLineFrom(facts) {
  if (!facts || !facts.has_stat) return '';
  const a = (facts.appliance || 'appliance').toLowerCase();
  if (facts.top_component && facts.seen_n >= 2) {
    return `We've logged ${facts.based_on_n} of these ${a} repairs — ${facts.top_component.toLowerCase()} is the one we see most.`;
  }
  return `Backed by ${facts.based_on_n} real ${a} repairs in our own shop records.`;
}

module.exports = { SERIES, SERIES_ORDER, NEW_UNIT_RANGE, seriesFor, inferAppliance, repairCostFor, groundedFacts, proofLineFrom };
